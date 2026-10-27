const bcrypt = require('bcrypt');
const db = require('../models/db');
const { logAction } = require('../services/audit');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Simple in-memory brute-force protection: 5 failed attempts per IP+email per 15 minutes.
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;
const keyFor = (req, email) => `${req.ip}|${email}`;
const recentFails = (key) => {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter((t) => now - t < WINDOW_MS);
  attempts.set(key, list);
  return list;
};
const resetAttempts = () => attempts.clear();

const renderRegister = (res, status, errorMessage, values = {}) =>
  res.status(status).render('register', { errorMessage, values });
const renderLogin = (res, status, errorMessage, values = {}) =>
  res.status(status).render('login', { errorMessage, values });

const register = async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const values = { name, email };

  if (!name || !email || !password) return renderRegister(res, 400, 'Name, email, and password are required.', values);
  if (name.length > 100) return renderRegister(res, 400, 'Name is too long.', values);
  if (!EMAIL_RE.test(email)) return renderRegister(res, 400, 'Please enter a valid email address.', values);
  if (password.length < 8) return renderRegister(res, 400, 'Password must be at least 8 characters long.', values);
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return renderRegister(res, 400, 'Password must contain at least one letter and one number.', values);
  }

  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
    return renderRegister(res, 400, 'An account with this email already exists.', values);
  }

  const hashed = await bcrypt.hash(password, 10);
  try {
    // Public registration always creates an applicant; admin accounts are provisioned by HR/IT.
    const info = db.prepare("INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, 'applicant')").run(name, email, hashed);
    logAction(info.lastInsertRowid, 'REGISTER', `New applicant account registered: ${email}.`, req);
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return renderRegister(res, 400, 'An account with this email already exists.', values);
    throw e;
  }
  return res.redirect('/login?msg=' + encodeURIComponent('Account created. You can now log in.'));
};

const login = async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const values = { email };
  if (!email || !password) return renderLogin(res, 400, 'Email and password are required.', values);

  const key = keyFor(req, email);
  if (recentFails(key).length >= MAX_FAILS) {
    logAction(null, 'LOGIN_BLOCKED', `Too many failed logins for ${email}.`, req);
    return renderLogin(res, 429, 'Too many failed attempts. Please try again in 15 minutes.', values);
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  // Compare against a dummy hash when the user is unknown so timing does not reveal which emails exist.
  const hash = user ? user.password : '$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi';
  const ok = await bcrypt.compare(password, hash);
  if (!user || !ok) {
    recentFails(key).push(Date.now());
    logAction(user ? user.id : null, 'LOGIN_FAILED', `Failed login attempt for ${email}.`, req);
    return renderLogin(res, 400, 'Invalid email or password.', values);
  }
  attempts.delete(key);

  // New session id on privilege change prevents session fixation.
  req.session.regenerate((err) => {
    if (err) {
      console.error('Session regenerate error:', err);
      return res.status(500).render('500');
    }
    req.session.userId = user.id;
    req.session.role = user.role;
    const info = db.prepare('INSERT INTO login_sessions (user_id, session_id, ip, user_agent) VALUES (?, ?, ?, ?)')
      .run(user.id, req.sessionID, req.ip || null, String(req.get('user-agent') || '').slice(0, 255));
    req.session.loginSessionId = info.lastInsertRowid;
    logAction(user.id, 'LOGIN', `User ${user.email} logged in successfully as ${user.role}.`, req);
    req.session.save(() => res.redirect('/dashboard'));
  });
};

const logout = (req, res) => {
  const userId = req.session && req.session.userId;
  const loginSessionId = req.session && req.session.loginSessionId;
  if (userId) {
    if (loginSessionId) db.prepare('UPDATE login_sessions SET logout_at = CURRENT_TIMESTAMP WHERE id = ?').run(loginSessionId);
    logAction(userId, 'LOGOUT', 'User logged out.', req);
  }
  req.session.destroy(() => {
    res.clearCookie('connect.sid', { path: '/' });
    res.redirect('/login');
  });
};

module.exports = { register, login, logout, resetAttempts };
