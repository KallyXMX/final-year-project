// Redirect with a one-shot flash message shown by the layout (?msg=...&type=error|success).
const redirectWith = (res, url, msg, type = 'success') => {
  const sep = url.includes('?') ? '&' : '?';
  return res.redirect(`${url}${sep}msg=${encodeURIComponent(msg)}&type=${type}`);
};

const toInt = (v, fallback = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};

module.exports = { redirectWith, toInt };
