// In-app notifications (Requirements 4.2, 4.3). Layer: Application / Data.
const db = require('../models/db');

// In-app notifications (Requirements 4.2, 4.3). Email/SMS are out of scope.
const notify = (userId, message, link = null) => {
  try {
    db.prepare('INSERT INTO notifications (user_id, message, link) VALUES (?, ?, ?)').run(userId, message, link);
  } catch (error) {
    console.error('Error saving notification:', error);
  }
};

const unreadCount = (userId) =>
  db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0').get(userId).c;

const listForUser = (userId, limit = 100) =>
  db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(userId, limit);

const markAllRead = (userId) =>
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(userId);

module.exports = { notify, unreadCount, listForUser, markAllRead };
