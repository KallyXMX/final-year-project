// Server-side parsing and validation of the per-vacancy points scheme and exam switches.
// Every number must be a non-negative whole number inside its maximum; nothing is silently "fixed".
const { POINTS } = require('./qualifications');

const MAX_POINTS = 100; // an academic score is capped at 100, so no single item may be worth more

const POINT_FIELDS = [
  { key: 'pts_phd', label: 'PhD points', def: POINTS.phd },
  { key: 'pts_master', label: "Master's points", def: POINTS.master },
  { key: 'pts_bachelor', label: "Bachelor's points", def: POINTS.bachelor },
  { key: 'pts_per_year', label: 'Points per year of experience', def: POINTS.perYearExperience },
  { key: 'pts_per_publication', label: 'Points per publication', def: POINTS.perPublication },
  { key: 'pts_per_seminar', label: 'Points per seminar', def: POINTS.perSeminar }
];

// '12' -> 12. Rejects '', '-1', '1.5', '1e2', ' 3x', arrays, and anything above max.
const wholeNumber = (raw, label, max) => {
  if (typeof raw !== 'string' || !/^\d{1,6}$/.test(raw.trim())) return { error: `${label} must be a whole number (0 or more).` };
  const n = parseInt(raw.trim(), 10);
  if (n > max) return { error: `${label} cannot be more than ${max}.` };
  return { value: n };
};

// Returns { values, error }. `values` always holds the numbers the form sent (or the raw text, for re-display on error).
const parsePoints = (body) => {
  const values = {};
  let error = null;
  for (const f of POINT_FIELDS) {
    const raw = body[f.key];
    const r = wholeNumber(raw === undefined ? '' : raw, f.label, MAX_POINTS);
    values[f.key] = r.error ? (typeof raw === 'string' ? raw : '') : r.value;
    if (r.error && !error) error = r.error;
  }
  return { values, error };
};

// Checkboxes: present = on. Returns { values, error }.
const parseSwitches = (body, category) => {
  const on = (k) => body[k] === '1' || body[k] === 'on';
  const values = {
    aptitude_enabled: on('aptitude_enabled') ? 1 : 0,
    literacy_enabled: on('literacy_enabled') ? 1 : 0,
    academic_exam_enabled: category === 'academic' && on('academic_exam_enabled') ? 1 : 0
  };
  const error = values.aptitude_enabled + values.literacy_enabled === 0
    ? 'At least one exam section (Aptitude or Computer Literacy) must stay on.' : null;
  return { values, error };
};

module.exports = { MAX_POINTS, POINT_FIELDS, wholeNumber, parsePoints, parseSwitches };
