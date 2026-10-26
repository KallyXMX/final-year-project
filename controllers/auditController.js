const db = require('../models/db');

// Helper function to log actions
const logAction = (userId, action, description) => {
  try {
    const stmt = db.prepare('INSERT INTO audit_logs (user_id, action, description) VALUES (?, ?, ?)');
    stmt.run(userId, action, description);
  } catch (error) {
    console.error('Error saving audit log:', error);
  }
};

// Render audit logs for admin
const getLogs = (req, res) => {
  try {
    if (!req.session || req.session.role !== 'admin') {
      return res.status(403).send('Access denied: Admins only.');
    }

    const logs = db.prepare(`
      SELECT a.*, u.name as user_name, u.email as user_email
      FROM audit_logs a
      LEFT JOIN users u ON a.user_id = u.id
      ORDER BY a.timestamp DESC
      LIMIT 100
    `).all();

    return res.render('admin/audit_logs', { logs, user: req.session });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    return res.status(500).send('Internal server error fetching audit logs.');
  }
};

module.exports = {
  logAction,
  getLogs
};
