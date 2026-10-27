// Authentication + role-based access control (Requirement 4.8: Applicant / Admin).

const isLoggedIn = (req) => !!(req.session && req.session.userId);

const requireAuth = (req, res, next) => {
  if (!isLoggedIn(req)) {
    return res.redirect('/login');
  }
  next();
};

const requireAdmin = (req, res, next) => {
  if (!isLoggedIn(req)) {
    return res.redirect('/login');
  }
  if (req.session.role !== 'admin') {
    return res.status(403).render('403');
  }
  next();
};

const requireApplicant = (req, res, next) => {
  if (!isLoggedIn(req)) {
    return res.redirect('/login');
  }
  if (req.session.role !== 'applicant') {
    return res.status(403).render('403');
  }
  next();
};

module.exports = { requireAuth, requireAdmin, requireApplicant, isLoggedIn };
