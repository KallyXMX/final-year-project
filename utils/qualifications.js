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

const academicBreakdown = ({ highest_qualification, experience_years, journal_publications_count, seminars_attended }) => {
  const lvl = levelOf(highest_qualification);
  const degreePoints = lvl === 3 ? POINTS.phd : lvl === 2 ? POINTS.master : lvl === 1 ? POINTS.bachelor : 0;
  const expPoints = (parseInt(experience_years, 10) || 0) * POINTS.perYearExperience;
  const pubPoints = (parseInt(journal_publications_count, 10) || 0) * POINTS.perPublication;
  const semPoints = (parseInt(seminars_attended, 10) || 0) * POINTS.perSeminar;
  return { degreePoints, expPoints, pubPoints, semPoints, total: degreePoints + expPoints + pubPoints + semPoints };
};

// One entry per non-empty line.
const splitLines = (text) =>
  String(text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

module.exports = { LEVELS, LEVEL_LABELS, POINTS, levelOf, academicBreakdown, splitLines };
