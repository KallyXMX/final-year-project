// Applicant notification inbox (Requirements 4.2, 4.3). Pure request/response; data access is in services/notifications.js.
const notifications = require('../services/notifications');

const list = (req, res) => {
  res.render('notifications', { notifications: notifications.listForUser(req.session.userId) });
};

const markAllRead = (req, res) => {
  notifications.markAllRead(req.session.userId);
  res.redirect('/notifications');
};

module.exports = { list, markAllRead };
