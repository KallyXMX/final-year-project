// Middleware to enforce authentication and role-based access control

const requireAuth = (req, res, next) => {
  if (!req.session || (!req.session.user && !req.session.userId)) {
    return res.redirect('/login');
  }
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.session || (!req.session.user && !req.session.userId)) {
    return res.redirect('/login');
  }
  if (req.session.role !== 'admin') {
    return res.status(403).send('Access denied: Admins only.');
  }
  next();
};

module.exports = {
  requireAuth,
  requireAdmin
};
