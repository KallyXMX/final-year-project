// Makes the current user, unread count and date helpers available to every view. Layer: Application.
const users = require('../services/users');
const { unreadCount } = require('../services/notifications');
const time = require('../utils/time');

// Exposes the current user, unread notification count and formatting helpers to every view.
module.exports = (req, res, next) => {
  res.locals.currentUser = null;
  res.locals.unreadCount = 0;
  if (req.session && req.session.userId) {
    const u = users.findProfile(req.session.userId);
    if (u) {
      res.locals.currentUser = u;
      res.locals.unreadCount = unreadCount(u.id);
    } else {
      // account was removed: drop the stale session
      req.session.userId = null;
      req.session.role = null;
    }
  }
  res.locals.fmtDate = time.fmtDate;
  res.locals.fmtDateTime = time.fmtDateTime;
  res.locals.flash = req.query.msg ? { type: req.query.type === 'error' ? 'error' : 'success', text: String(req.query.msg).slice(0, 300) } : null;
  next();
};
