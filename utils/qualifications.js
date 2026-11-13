// Qualification levels and the academic point scheme (Requirements 2.5 / 4.5).
const LEVELS = { None: 0, Other: 0, Bachelor: 1, Master: 2, PhD: 3 };
const LEVEL_LABELS = { 0: 'Other / none', 1: "Bachelor's Degree / HND", 2: "Master's Degree", 3: 'PhD / Doctorate' };

// Accepts the canonical values from the form as well as legacy free text.
const levelOf = (text) => {
  const t = String(text || '').toLowerCase();
  if (!t) return 0;
  if (/ph\.?d|doctor/.test(t)) return 3;
  if (/master|m\.?sc|\bmba\b|\bm\.?eng\b|\bm\.?tech\b|\bm\.?ed\b|\bm\.?a\b/.test(t)) return 2;
  if (/bachelor|b\.?sc|\bb\.?eng\b|\bb\.?tech\b|\bb\.?a\b|\bhnd\b|first degree/.test(t)) return 1;
  return 0;
};

const POINTS = { phd: 40, master: 25, bachelor: 10, perYearExperience: 5, perPublication: 4, perSeminar: 2 };
const MAX_ACADEMIC_SCORE = 100;

// Cap any academic score at 100 (Requirement: score = min(score, 100)).
const capScore = (n) => Math.min(Number(n) || 0, MAX_ACADEMIC_SCORE);

// Build a points scheme from a vacancy row; missing/NULL columns (old rows) fall back to the defaults.
const schemeOf = (v) => {
  const pick = (val, def) => (val === null || val === undefined || val === '' || isNaN(+val) ? def : +val);
  const o = v || {};
  return {
    phd: pick(o.pts_phd, POINTS.phd),
    master: pick(o.pts_master, POINTS.master),
    bachelor: pick(o.pts_bachelor, POINTS.bachelor),
    perYearExperience: pick(o.pts_per_year, POINTS.perYearExperience),
    perPublication: pick(o.pts_per_publication, POINTS.perPublication),
    perSeminar: pick(o.pts_per_seminar, POINTS.perSeminar)
  };
};

// `raw` is the uncapped sum; `total` is what is stored and shown (max 100).
const academicBreakdown = ({ highest_qualification, experience_years, journal_publications_count, seminars_attended }, scheme = POINTS) => {
  const lvl = levelOf(highest_qualification);
  const degreePoints = lvl === 3 ? scheme.phd : lvl === 2 ? scheme.master : lvl === 1 ? scheme.bachelor : 0;
  const expPoints = (parseInt(experience_years, 10) || 0) * scheme.perYearExperience;
  const pubPoints = (parseInt(journal_publications_count, 10) || 0) * scheme.perPublication;
  const semPoints = (parseInt(seminars_attended, 10) || 0) * scheme.perSeminar;
  const raw = degreePoints + expPoints + pubPoints + semPoints;
  return { degreePoints, expPoints, pubPoints, semPoints, raw, total: capScore(raw) };
};

// One entry per non-empty line.
const splitLines = (text) =>
  String(text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

module.exports = { LEVELS, LEVEL_LABELS, POINTS, MAX_ACADEMIC_SCORE, capScore, schemeOf, levelOf, academicBreakdown, splitLines };
