// Data access for user accounts and login sessions (Requirement 4.8).
const db = require('../models/db');

const findByEmail = (email) => db.prepare('SELECT * FROM users WHERE email = ?').get(email);
const emailExists = (email) => !!db.prepare('SELECT id FROM users WHERE email = ?').get(email);
const findProfile = (id) => db.prepare('SELECT id, name, email, role, created_at FROM users WHERE id = ?').get(id);
const countApplicants = () => db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'applicant'").get().c;

// Public registration always creates an applicant; admin accounts are provisioned by HR/IT.
const createApplicant = (name, email, passwordHash) =>
  db.prepare("INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, 'applicant')").run(name, email, passwordHash).lastInsertRowid;

const recordLogin = (userId, sessionId, ip, userAgent) =>
  db.prepare('INSERT INTO login_sessions (user_id, session_id, ip, user_agent) VALUES (?, ?, ?, ?)')
    .run(userId, sessionId, ip || null, String(userAgent || '').slice(0, 255)).lastInsertRowid;

const recordLogout = (loginSessionId) =>
  db.prepare('UPDATE login_sessions SET logout_at = CURRENT_TIMESTAMP WHERE id = ?').run(loginSessionId);

module.exports = { findByEmail, emailExists, findProfile, countApplicants, createApplicant, recordLogin, recordLogout };
