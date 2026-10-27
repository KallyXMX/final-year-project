const session = require('express-session');
const db = require('../models/db');

// Minimal express-session store backed by the application's SQLite database,
// so sessions survive a server restart (the default MemoryStore does not).
class SqliteStore extends session.Store {
  constructor() {
    super();
    this._get = db.prepare('SELECT sess FROM http_sessions WHERE sid = ? AND expires > ?');
    this._set = db.prepare('INSERT INTO http_sessions (sid, sess, expires) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires');
    this._del = db.prepare('DELETE FROM http_sessions WHERE sid = ?');
    this._touch = db.prepare('UPDATE http_sessions SET expires = ? WHERE sid = ?');
    this._purge = db.prepare('DELETE FROM http_sessions WHERE expires <= ?');
    this.timer = setInterval(() => this._purge.run(Date.now()), 10 * 60 * 1000);
    this.timer.unref();
  }

  _expiry(sess) {
    const exp = sess && sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 2 * 3600 * 1000;
    return exp;
  }

  get(sid, cb) {
    try {
      const row = this._get.get(sid, Date.now());
      cb(null, row ? JSON.parse(row.sess) : null);
    } catch (e) { cb(e); }
  }
  set(sid, sess, cb) {
    try { this._set.run(sid, JSON.stringify(sess), this._expiry(sess)); cb && cb(null); } catch (e) { cb && cb(e); }
  }
  destroy(sid, cb) {
    try { this._del.run(sid); cb && cb(null); } catch (e) { cb && cb(e); }
  }
  touch(sid, sess, cb) {
    try { this._touch.run(this._expiry(sess), sid); cb && cb(null); } catch (e) { cb && cb(e); }
  }
}

module.exports = SqliteStore;
