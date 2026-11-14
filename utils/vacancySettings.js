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

// Category maxima of the combined recruitment score (Personal data 10, Qualification 30, Experience 20, Publications 20,
// Interview 20 = 100). Defaults are only what the form is pre-filled with; a vacancy may also have none (legacy scoring).
const MAX_FIELDS = [
  { key: 'max_qualification', label: 'Educational qualification maximum', def: 30 },
  { key: 'max_experience', label: 'Relevant experience maximum', def: 20 },
  { key: 'max_publications', label: 'Publications maximum', def: 20 },
  { key: 'max_personal_data', label: 'Personal data maximum', def: 10 },
  { key: 'max_interview', label: 'Physical interview maximum', def: 20 }
];
const MAX_TOTAL = 100;
const NO_MAXIMA = () => Object.fromEntries(MAX_FIELDS.map((f) => [f.key, null]));
const blank = (x) => x === undefined || x === null || (typeof x === 'string' && x.trim() === '');

// All five blank -> legacy scoring (all NULL). Otherwise each must be a whole number 0-100 and the five must add up to 100.
const parseMaxima = (body) => {
  if (MAX_FIELDS.every((f) => blank(body[f.key]))) return { values: NO_MAXIMA(), error: null, legacy: true };
  const values = {};
  let error = null;
  for (const f of MAX_FIELDS) {
    const raw = body[f.key];
    if (blank(raw)) { values[f.key] = ''; error = error || 'Fill in all five maximum points, or leave all five empty to keep the old scoring.'; continue; }
    const r = wholeNumber(raw, f.label, MAX_POINTS);
    values[f.key] = r.error ? (typeof raw === 'string' ? raw : '') : r.value;
    if (r.error && !error) error = r.error;
  }
  if (!error) {
    const sum = MAX_FIELDS.reduce((s, f) => s + values[f.key], 0);
    if (sum !== MAX_TOTAL) error = `The five maximum points must add up to exactly ${MAX_TOTAL} (they add up to ${sum}).`;
  }
  return { values, error, legacy: false };
};

// Optional number of positions: blank = not set, otherwise a whole number 1-1000.
const MAX_SLOTS = 1000;
const parseSlots = (body) => {
  const raw = body.slots;
  if (blank(raw)) return { value: null, error: null };
  const r = wholeNumber(raw, 'Number of positions', MAX_SLOTS);
  if (r.error) return { value: typeof raw === 'string' ? raw : '', error: r.error };
  if (r.value < 1) return { value: raw, error: 'Number of positions must be at least 1 (or leave it empty).' };
  return { value: r.value, error: null };
};

// A score with at most two decimal places between 0 and max, e.g. '17.5', '8', '0.25'. Rejects '', '-1', '1e1', '.5', '5.', '1.234'.
const parseScore = (raw, label, max) => {
  if (typeof raw !== 'string' || !/^\d{1,3}(\.\d{1,2})?$/.test(raw.trim())) {
    return { error: `${label} must be a number from 0 to ${max} with at most two decimal places.` };
  }
  const n = Math.round(parseFloat(raw.trim()) * 100) / 100;
  if (n > max) return { error: `${label} cannot be more than ${max}.` };
  return { value: n };
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

module.exports = { MAX_POINTS, POINT_FIELDS, MAX_FIELDS, MAX_TOTAL, NO_MAXIMA, wholeNumber, parsePoints, parseMaxima, parseSlots, parseScore, parseSwitches };
