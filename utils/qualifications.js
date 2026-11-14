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

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Category maxima of the combined recruitment score. All five must be set; if any is NULL (old vacancies) the
// vacancy keeps the legacy scoring: no category caps and no combined total.
const CAP_COLUMNS = ['max_qualification', 'max_experience', 'max_publications', 'max_personal_data', 'max_interview'];
const capsOf = (v) => {
  const o = v || {};
  if (CAP_COLUMNS.some((k) => o[k] === null || o[k] === undefined || o[k] === '' || isNaN(+o[k]))) return null;
  return { qualification: +o.max_qualification, experience: +o.max_experience, publications: +o.max_publications,
    personalData: +o.max_personal_data, interview: +o.max_interview };
};

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
    perSeminar: pick(o.pts_per_seminar, POINTS.perSeminar),
    caps: capsOf(o)
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
  const caps = scheme.caps || null;
  if (!caps) return { degreePoints, expPoints, pubPoints, semPoints, raw, total: capScore(raw) };
  // Combined scoring: three parts, each capped at its own maximum (publications and seminars share one cap).
  const parts = {
    qualification: Math.min(degreePoints, caps.qualification),
    experience: Math.min(expPoints, caps.experience),
    publications: Math.min(pubPoints + semPoints, caps.publications)
  };
  return { degreePoints, expPoints, pubPoints, semPoints, raw, parts, caps, total: capScore(parts.qualification + parts.experience + parts.publications) };
};

// Combined recruitment score = academic part + personal data + interview (out of 100).
// Returns null for legacy vacancies (no maxima). `a` holds the applicant's figures and scores, `v` the vacancy's settings.
const combinedOf = (a, v) => {
  const scheme = schemeOf(v);
  if (!scheme.caps) return null;
  const b = academicBreakdown(a, scheme);
  const num = (x) => (x === null || x === undefined || x === '' ? null : Number(x));
  const personal = num(a.personal_data_score);
  const interview = num(a.interview_score);
  return {
    caps: scheme.caps, parts: b.parts, academic: b.total, personal, interview,
    total: round2(b.total + (personal || 0) + (interview || 0)),
    complete: personal !== null && interview !== null
  };
};

// One entry per non-empty line.
const splitLines = (text) =>
  String(text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

module.exports = { LEVELS, LEVEL_LABELS, POINTS, MAX_ACADEMIC_SCORE, CAP_COLUMNS, round2, capScore, capsOf, schemeOf, combinedOf, levelOf, academicBreakdown, splitLines };
