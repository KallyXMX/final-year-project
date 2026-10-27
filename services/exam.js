const db = require('../models/db');
const { examState, isAcademic } = require('../utils/vacancy');
const { parseDbDate } = require('../utils/time');
const { notify } = require('./notifications');
const { logAction } = require('./audit');

// Requirement 4.4 / 6.3 "Examination engine": question randomisation, section timers,
// auto-submission, auto-marking, weighted scoring and a configurable pass mark.

const SECTIONS = ['Aptitude', 'Computer Literacy'];
const GRACE_MS = 15 * 1000; // network latency allowance for auto-submitted answers

const sectionConfig = (v) => [
  { name: 'Aptitude', minutes: v.aptitude_minutes || 20, weight: v.aptitude_weight ?? 50 },
  { name: 'Computer Literacy', minutes: v.literacy_minutes || 20, weight: v.literacy_weight ?? 50 }
];

const sectionDeadline = (s) => new Date(parseDbDate(s.started_at).getTime() + s.minutes * 60000);

// Can this application sit the exam right now? Returns { ok, reason }.
const eligibility = (application, vacancy, now = new Date()) => {
  if (!application) return { ok: false, reason: 'You have not applied for this vacancy.' };
  if (isAcademic(vacancy)) return { ok: false, reason: 'Academic positions are assessed on qualifications; there is no online test for this vacancy.' };
  if (application.exam_completed) return { ok: false, reason: 'You have already completed this examination.' };
  if (application.status !== 'Shortlisted') {
    return { ok: false, reason: application.status === 'Pending'
      ? 'You can take the examination only after you have been shortlisted.'
      : `Your application status is "${application.status}", so you are not eligible for the examination.` };
  }
  const st = examState(vacancy, now);
  if (st === 'NotScheduled') return { ok: false, reason: 'The examination has not been scheduled yet. You will be notified.' };
  if (st === 'Upcoming') return { ok: false, reason: 'The examination has not started yet.', state: st };
  if (st === 'Ended') return { ok: false, reason: 'The examination window has closed.', state: st };
  return { ok: true };
};

const loadAttempt = (applicationId) =>
  db.prepare('SELECT * FROM exam_attempts WHERE application_id = ?').get(applicationId);

const parseSections = (attempt) => JSON.parse(attempt.sections_json);

const saveAttempt = (attempt, sections) => {
  // Keep the in-memory attempt in step with the database: advance() and gradeAttempt() re-read
  // sections_json from this object, and a stale copy lost the last section's answers and
  // crashed when the next section's timer had not been recorded yet.
  attempt.sections_json = JSON.stringify(sections);
  db.prepare('UPDATE exam_attempts SET sections_json = ?, current_section = ?, finished_at = ? WHERE id = ?')
    .run(JSON.stringify(sections), attempt.current_section, attempt.finished_at || null, attempt.id);
};

// Build a fresh randomised paper: N random questions from each section's pool.
const createAttempt = (application, vacancy, now = new Date()) => {
  const perSection = vacancy.questions_per_section || 10;
  const sections = [];
  for (const cfg of sectionConfig(vacancy)) {
    const ids = db.prepare('SELECT id FROM questions WHERE vacancy_id = ? AND section = ? ORDER BY RANDOM() LIMIT ?')
      .all(vacancy.id, cfg.name, perSection).map((r) => r.id);
    if (ids.length > 0) {
      sections.push({ name: cfg.name, minutes: cfg.minutes, weight: cfg.weight, question_ids: ids, answers: {}, started_at: null, submitted_at: null });
    }
  }
  if (sections.length === 0) return null;
  sections[0].started_at = now.toISOString();
  const info = db.prepare(`INSERT INTO exam_attempts (application_id, user_id, vacancy_id, sections_json, current_section, started_at)
    VALUES (?, ?, ?, ?, 0, ?)`).run(application.id, application.user_id, vacancy.id, JSON.stringify(sections), now.toISOString());
  return db.prepare('SELECT * FROM exam_attempts WHERE id = ?').get(info.lastInsertRowid);
};

// Weighted scoring across sections; pass mark taken from the vacancy configuration.
const gradeAttempt = (attempt) => {
  const sections = parseSections(attempt);
  const vacancy = db.prepare('SELECT * FROM vacancies WHERE id = ?').get(attempt.vacancy_id);
  const qStmt = db.prepare('SELECT id, correct_option FROM questions WHERE id = ?');
  let correctAll = 0, totalAll = 0, weightSum = 0, weighted = 0;
  const breakdown = [];
  for (const s of sections) {
    let correct = 0;
    for (const qid of s.question_ids) {
      const q = qStmt.get(qid);
      const ans = s.answers[qid];
      if (q && ans && String(ans).toUpperCase() === String(q.correct_option).toUpperCase()) correct++;
    }
    const total = s.question_ids.length;
    const pct = total ? (correct / total) * 100 : 0;
    breakdown.push({ section: s.name, correct, total, percentage: Math.round(pct * 100) / 100, weight: s.weight });
    correctAll += correct; totalAll += total;
    weightSum += s.weight; weighted += s.weight * pct;
  }
  const percentage = weightSum > 0 ? weighted / weightSum : (totalAll ? (correctAll / totalAll) * 100 : 0);
  const rounded = Math.round(percentage * 100) / 100;
  const passMark = vacancy.pass_mark ?? 50;
  return { correct: correctAll, total: totalAll, percentage: rounded, passed: rounded >= passMark ? 1 : 0, breakdown, passMark };
};

const finishAttempt = (attempt, sections) => {
  attempt.finished_at = new Date().toISOString();
  saveAttempt(attempt, sections);
  const g = gradeAttempt(attempt);
  const application = db.prepare('SELECT * FROM applications WHERE id = ?').get(attempt.application_id);
  const vacancy = db.prepare('SELECT * FROM vacancies WHERE id = ?').get(attempt.vacancy_id);

  db.transaction(() => {
    db.prepare(`INSERT INTO exam_results (user_id, vacancy_id, score, total_questions, percentage, passed, section_scores)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, vacancy_id) DO NOTHING`)
      .run(attempt.user_id, attempt.vacancy_id, g.correct, g.total, g.percentage, g.passed, JSON.stringify(g.breakdown));
    db.prepare('UPDATE applications SET exam_completed = 1, exam_score = ? WHERE id = ?').run(g.percentage, attempt.application_id);
  })();

  logAction(attempt.user_id, 'SCORE_CHANGE',
    `CBT exam marked automatically. Score: ${g.percentage.toFixed(2)}% (${g.passed ? 'passed' : 'failed'}) for Vacancy ID: ${attempt.vacancy_id}.`);
  notify(attempt.user_id,
    `Your examination for "${vacancy.title}" has been marked: ${g.correct}/${g.total} (${g.percentage.toFixed(1)}%) - ${g.passed ? 'PASSED' : 'did not reach the pass mark'}.`,
    '/my-applications');
  return g;
};

// Bring an attempt up to date with the clock: auto-submit sections whose time has expired
// and move on. Returns the (possibly finished) attempt.
const advance = (attempt, now = new Date()) => {
  if (attempt.finished_at) return attempt;
  const sections = parseSections(attempt);
  let changed = false;
  while (attempt.current_section < sections.length) {
    const s = sections[attempt.current_section];
    if (!s.submitted_at && now > new Date(sectionDeadline(s).getTime() + GRACE_MS)) {
      s.submitted_at = sectionDeadline(s).toISOString(); // auto-submitted at the deadline
      changed = true;
    }
    if (!s.submitted_at) break;
    attempt.current_section++;
    changed = true;
    if (attempt.current_section < sections.length) {
      // the next section's clock starts when the previous one ended
      sections[attempt.current_section].started_at = s.submitted_at;
    }
  }
  if (attempt.current_section >= sections.length) {
    finishAttempt(attempt, sections);
    return db.prepare('SELECT * FROM exam_attempts WHERE id = ?').get(attempt.id);
  }
  if (changed) saveAttempt(attempt, sections);
  return attempt;
};

// Submit the current section's answers (also used for client-side auto-submit on timeout).
const submitSection = (attempt, sectionIndex, answers, now = new Date()) => {
  if (attempt.finished_at) return attempt;
  const sections = parseSections(attempt);
  if (sectionIndex !== attempt.current_section) return advance(attempt, now);
  const s = sections[attempt.current_section];
  const withinTime = now <= new Date(sectionDeadline(s).getTime() + GRACE_MS);
  if (withinTime) {
    for (const qid of s.question_ids) {
      const a = answers[`q_${qid}`];
      if (typeof a === 'string' && /^[ABCD]$/i.test(a.trim())) s.answers[qid] = a.trim().toUpperCase();
    }
  }
  s.submitted_at = withinTime ? now.toISOString() : sectionDeadline(s).toISOString();
  attempt.current_section++;
  if (attempt.current_section < sections.length) {
    sections[attempt.current_section].started_at = s.submitted_at;
    saveAttempt(attempt, sections);
    return advance(attempt, now);
  }
  finishAttempt(attempt, sections);
  return db.prepare('SELECT * FROM exam_attempts WHERE id = ?').get(attempt.id);
};

// Scheduler job: grade attempts that were abandoned (browser closed, no network...).
const finalizeStaleAttempts = () => {
  const open = db.prepare('SELECT * FROM exam_attempts WHERE finished_at IS NULL').all();
  let n = 0;
  for (const a of open) {
    const after = advance(a);
    if (after.finished_at) n++;
  }
  return n;
};

// Questions for the current section, without the answers (never send correct_option to the browser).
const currentSectionView = (attempt) => {
  const sections = parseSections(attempt);
  const s = sections[attempt.current_section];
  const stmt = db.prepare('SELECT id, question_text, option_a, option_b, option_c, option_d FROM questions WHERE id = ?');
  const questions = s.question_ids.map((id) => stmt.get(id)).filter(Boolean);
  const remainingMs = Math.max(0, sectionDeadline(s).getTime() - Date.now());
  return {
    index: attempt.current_section,
    total: sections.length,
    name: s.name,
    minutes: s.minutes,
    questions,
    remainingSeconds: Math.floor(remainingMs / 1000),
    answers: s.answers
  };
};

module.exports = {
  SECTIONS, sectionConfig, eligibility, loadAttempt, createAttempt, advance, submitSection,
  finalizeStaleAttempts, currentSectionView, gradeAttempt
};
