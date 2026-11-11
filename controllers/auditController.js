// Admin pages for the audit log and login sessions (Requirement 4.8). Queries live in services/audit.js.
const audit = require('../services/audit');

const getLogs = (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const action = (req.query.action || '').trim();
  const { logs, total, pages } = audit.listLogs({ page, action });
  res.render('admin/audit-logs', { logs, page, pages, actions: audit.listActions(), action, total });
};

const getSessions = (req, res) => {
  res.render('admin/sessions', { sessions: audit.listLoginSessions() });
};

module.exports = { getLogs, getSessions };
