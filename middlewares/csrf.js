// CSRF protection (Requirement 4.8). Layer: Application.
const crypto = require('crypto');
const fs = require('fs');

// Synchronizer-token CSRF protection. Every POST form carries a hidden "_csrf" field.
// Multipart forms put the token in the action URL (?_csrf=...) because the body is not
// parsed until multer runs; use verifyCsrf after multer on those routes.

const ensureToken = (req, res, next) => {
  if (req.session) {
    if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(24).toString('hex');
    res.locals.csrfToken = req.session.csrfToken;
  } else {
    res.locals.csrfToken = '';
  }
  next();
};

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};

const tokenFrom = (req) =>
  (req.body && req.body._csrf) || (req.query && req.query._csrf) || req.get('x-csrf-token');

// On multipart routes Multer has already saved the uploaded files by the time the token is checked.
// If the check fails those files would be orphans, so delete them.
const discardUploads = (req) => {
  const files = Array.isArray(req.files) ? req.files : req.files ? Object.values(req.files).flat() : req.file ? [req.file] : [];
  files.forEach((f) => { try { fs.unlinkSync(f.path); } catch (e) { /* already gone */ } });
};

const verifyCsrf = (req, res, next) => {
  const expected = req.session && req.session.csrfToken;
  if (!expected || !safeEqual(tokenFrom(req), expected)) {
    discardUploads(req);
    return res.status(403).render('403', { reason: 'Your session form token is invalid or has expired. Please go back, refresh the page and try again.' });
  }
  next();
};

// Global guard: all state-changing requests except multipart ones (checked per-route).
const csrfProtection = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const type = req.headers['content-type'] || '';
  if (type.startsWith('multipart/form-data')) return next();
  // The login/register forms have no session token yet beyond the one issued on GET.
  return verifyCsrf(req, res, next);
};

module.exports = { ensureToken, csrfProtection, verifyCsrf };
