const db = require('../models/db');
const { logAction } = require('../services/audit');

const PAGE_SIZE = 50;

// Audit log viewer (admin only) - Requirement 4.8
const getLogs = (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const action = (req.query.action || '').trim();
  const where = action ? 'WHERE a.action = ?' : '';
  const params = action ? [action] : [];
  const total = db.prepare(`SELECT COUNT(*) AS c FROM audit_logs a ${where}`).get(...params).c;
  const logs = db.prepare(`
    SELECT a.*, u.name AS user_name, u.email AS user_email
    FROM audit_logs a LEFT JOIN users u ON a.user_id = u.id
    ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`).all(...params, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const actions = db.prepare('SELECT DISTINCT action FROM audit_logs ORDER BY action').all().map((r) => r.action);
  res.render('admin/audit_logs', { logs, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), actions, action, total });
};

// Login session tracking (admin only) - Requirement 4.8
const getSessions = (req, res) => {
  const sessions = db.prepare(`
    SELECT s.*, u.name AS user_name, u.email AS user_email, u.role
    FROM login_sessions s JOIN users u ON u.id = s.user_id
    ORDER BY s.id DESC LIMIT 200`).all();
  res.render('admin/sessions', { sessions });
};

module.exports = { logAction, getLogs, getSessions };
