/**
 * noCache middleware
 * Prevents browsers from caching authenticated responses.
 * Apply to any route that requires a live session (dashboard, admin, etc.)
 * so the back-button cannot replay a stale snapshot after logout.
 */
const noCache = (req, res, next) => {
  res.set({
    'Cache-Control': 'no-cache, private, no-store, must-revalidate, max-stale=0, post-check=0, pre-check=0',
    'Pragma': 'no-cache',
    'Expires': '0',
  });
  next();
};

module.exports = noCache;
