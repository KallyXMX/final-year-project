const db = require('../models/db');

const list = (req, res) => {
  const notifications = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(req.session.userId);
  res.render('notifications', { notifications });
};

const markAllRead = (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.session.userId);
  res.redirect('/notifications');
};

module.exports = { list, markAllRead };
