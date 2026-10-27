const db = require('../models/db');

// In-app notifications (Requirements 4.2, 4.3).
const notify = (userId, message, link = null) => {
  try {
    db.prepare('INSERT INTO notifications (user_id, message, link) VALUES (?, ?, ?)').run(userId, message, link);
  } catch (error) {
    console.error('Error saving notification:', error);
  }
};

const unreadCount = (userId) =>
  db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0').get(userId).c;

module.exports = { notify, unreadCount };
