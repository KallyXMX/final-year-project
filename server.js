const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('./models/db');
const noCache = require('./middlewares/noCache');
const authRoutes = require('./routes/authRoutes.js');
const vacancyRoutes = require('./routes/vacancyRoutes.js');
const examRoutes = require('./routes/examRoutes.js');

const app = express();
const PORT = process.env.PORT || 3000;

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Prevent browser back-button access to authenticated pages after logout
app.use(noCache);

// Express session configuration
app.use(
  session({
    secret: 'buk_recruitment_dummy_secret',
    resave: false,
    saveUninitialized: false,
  })
);

// Register endpoints
app.use('/', authRoutes);
app.use('/', vacancyRoutes);
app.use('/', examRoutes);

app.get('/', (req, res) => {
  res.send('BUK Online Examination System is running!');
});

const vacancyController = require('./controllers/vacancyController');
const examController = require('./controllers/examController');
const { requireAuth, requireAdmin } = require('./middlewares/auth');

// Dashboard route with session check
app.get('/dashboard', requireAuth, vacancyController.getAdminAnalytics);

// Exam submission route
app.post('/exam/submit', requireAuth, examController.submitExam);

const reportController = require('./controllers/reportController');

// Admin Reports routes
app.get('/admin/reports/pdf', requireAdmin, reportController.exportMeritListPDF);
app.get('/admin/reports/csv', requireAdmin, reportController.exportApplicantsCSV);

const applicationController = require('./controllers/applicationController');

// Academic Recruitment routes
app.get('/admin/applications/:id/academic-summary', requireAdmin, applicationController.renderAcademicSummary);
app.post('/admin/applications/:id/academic-score', requireAdmin, applicationController.calculateAcademicScore);
app.post('/admin/vacancies/:id/shortlist', requireAdmin, applicationController.runAutoShortlist);
app.post('/admin/applications/:id/interview', requireAdmin, applicationController.recordInterviewResult);
app.get('/admin/applications', requireAdmin, applicationController.getAllApplications);

const auditController = require('./controllers/auditController');

app.get('/admin/audit-logs', requireAdmin, auditController.getLogs);

// Start listening
app.use((req, res) => {
  res.status(404).render('404');
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('500');
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

module.exports = { app, db };
