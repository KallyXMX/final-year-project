// Audit log (Requirement 4.8): writes one row per key action and reads them for the admin pages.
// Layer: Application / Data.
const db = require('../models/db');

// Record a key action (Requirement 4.8). Never throws: logging must not break a request.
const logAction = (userId, action, description, req) => {
  try {
    const ip = req ? (req.ip || (req.socket && req.socket.remoteAddress) || null) : null;
    db.prepare('INSERT INTO audit_logs (user_id, action, description, ip) VALUES (?, ?, ?, ?)')
      .run(userId || null, action, description, ip);
  } catch (error) {
    console.error('Error saving audit log:', error);
  }
};

// ---- Read side, used by the admin audit-log and login-session pages (Requirement 4.8) ----
const PAGE_SIZE = 50;

const listLogs = ({ page, action }) => {
  const where = action ? 'WHERE a.action = ?' : '';
  const params = action ? [action] : [];
  const total = db.prepare(`SELECT COUNT(*) AS c FROM audit_logs a ${where}`).get(...params).c;
  const logs = db.prepare(`
    SELECT a.*, u.name AS user_name, u.email AS user_email
    FROM audit_logs a LEFT JOIN users u ON a.user_id = u.id
    ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`).all(...params, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  return { logs, total, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
};

const listActions = () =>
  db.prepare('SELECT DISTINCT action FROM audit_logs ORDER BY action').all().map((r) => r.action);

const listLoginSessions = (limit = 200) =>
  db.prepare(`
    SELECT s.*, u.name AS user_name, u.email AS user_email, u.role
    FROM login_sessions s JOIN users u ON u.id = s.user_id
    ORDER BY s.id DESC LIMIT ?`).all(limit);

module.exports = { logAction, listLogs, listActions, listLoginSessions };
