const express = require('express');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const SqliteStore = require('./middlewares/sqliteStore');
const noCache = require('./middlewares/noCache');
const locals = require('./middlewares/locals');
const { ensureToken, csrfProtection } = require('./middlewares/csrf');

const isProd = process.env.NODE_ENV === 'production';
if (isProd && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set in production.');
}
// Without SESSION_SECRET (development) a random secret is used; sessions reset on restart.
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Security headers
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin'
  });
  next();
});

app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(express.json({ limit: '100kb' }));

// Only the stylesheet folder and the bundled chart library are public.
// Applicant documents are NOT served statically (see the authorised /applications/:id/documents route).
app.use('/css', express.static(path.join(__dirname, 'public', 'css')));
app.use('/vendor/chart.js', express.static(path.join(__dirname, 'node_modules', 'chart.js', 'dist')));

app.use(
  session({
    name: 'connect.sid',
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: new SqliteStore(),
    cookie: { httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: 2 * 60 * 60 * 1000 }
  })
);

app.use(noCache);
app.use(ensureToken);
app.use(csrfProtection);
app.use(locals);

app.get('/', (req, res) => res.redirect(req.session && req.session.userId ? '/dashboard' : '/vacancies'));

app.use('/', require('./routes/authRoutes'));
app.use('/', require('./routes/vacancyRoutes'));
app.use('/', require('./routes/applicationRoutes'));
app.use('/', require('./routes/examRoutes'));
app.use('/', require('./routes/reportRoutes'));
app.use('/', require('./routes/notificationRoutes'));

app.use((req, res) => res.status(404).render('404'));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  if (err instanceof multer.MulterError) {
    return res.status(400).render('500', { message: err.message });
  }
  res.status(500).render('500', { message: null });
});

module.exports = app;
