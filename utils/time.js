// Time helpers. The university operates in West Africa Time (UTC+1, no DST).
// All instants are stored in the database as UTC ISO strings ("2026-10-26T20:00:00.000Z").
const TZ = process.env.APP_TIMEZONE || 'Africa/Lagos';
const OFFSET_MIN = parseInt(process.env.APP_UTC_OFFSET_MINUTES || '60', 10);

const pad = (n) => String(n).padStart(2, '0');

// SQLite CURRENT_TIMESTAMP gives "YYYY-MM-DD HH:MM:SS" in UTC with no zone marker.
const parseDbDate = (value) => {
  if (!value) return null;
  const s = String(value);
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(s)) return new Date(s);
  return new Date(s.replace(' ', 'T') + 'Z');
};

// "datetime-local" input value (local wall-clock time) -> UTC ISO string.
const localInputToIso = (value) => {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const utcMs = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - OFFSET_MIN * 60000;
  return new Date(utcMs).toISOString();
};

// UTC ISO string -> value for a "datetime-local" input (local wall-clock time).
const isoToLocalInput = (iso) => {
  const d = parseDbDate(iso);
  if (!d || isNaN(d)) return '';
  const l = new Date(d.getTime() + OFFSET_MIN * 60000);
  return `${l.getUTCFullYear()}-${pad(l.getUTCMonth() + 1)}-${pad(l.getUTCDate())}T${pad(l.getUTCHours())}:${pad(l.getUTCMinutes())}`;
};

// Calendar date "YYYY-MM-DD" -> instant at the very start / end of that local day.
const startOfLocalDay = (ymd) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 0, 0, 0) - OFFSET_MIN * 60000);
};
const endOfLocalDay = (ymd) => {
  const s = startOfLocalDay(ymd);
  return s ? new Date(s.getTime() + 24 * 3600000 - 1000) : null;
};

const todayLocalYmd = (now = new Date()) => {
  const l = new Date(now.getTime() + OFFSET_MIN * 60000);
  return `${l.getUTCFullYear()}-${pad(l.getUTCMonth() + 1)}-${pad(l.getUTCDate())}`;
};

const fmtDateTime = (value) => {
  const d = value instanceof Date ? value : parseDbDate(value);
  if (!d || isNaN(d)) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' }).format(d);
};
const fmtDate = (value) => {
  if (!value) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const d = startOfLocalDay(value);
    return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, dateStyle: 'medium' }).format(d);
  }
  const d = value instanceof Date ? value : parseDbDate(value);
  if (!d || isNaN(d)) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, dateStyle: 'medium' }).format(d);
};

module.exports = {
  parseDbDate, localInputToIso, isoToLocalInput, startOfLocalDay, endOfLocalDay,
  todayLocalYmd, fmtDateTime, fmtDate
};
