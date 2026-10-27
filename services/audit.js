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

module.exports = { logAction };
