const fs = require('fs');
const path = require('path');
const db = require('../models/db');
const { logAction } = require('../services/audit');
const { notify } = require('../services/notifications');
const { shortlistVacancy } = require('../services/shortlisting');
const { vacancyState, examState } = require('../utils/vacancy');
const { academicBreakdown, splitLines, POINTS } = require('../utils/qualifications');
const { localInputToIso, isoToLocalInput, fmtDateTime } = require('../utils/time');
const { redirectWith, toInt } = require('../utils/http');
const { uploadDir } = require('../middlewares/upload');

// ------------------------------------------------------------ all applicants (search / filter)

const getAllApplications = (req, res) => {
  const { search, status, vacancy_id } = req.query;
  let sql = `
    SELECT a.*, u.name AS applicant_name, u.email AS applicant_email, v.title AS vacancy_title, v.category,
           er.score, er.total_questions, er.percentage
    FROM applications a
    JOIN users u ON a.user_id = u.id
    JOIN vacancies v ON a.vacancy_id = v.id
    LEFT JOIN exam_results er ON er.user_id = a.user_id AND er.vacancy_id = a.vacancy_id
    WHERE 1=1`;
  const params = [];
  if (search) { sql += ' AND (u.name LIKE ? OR u.email LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  if (status) { sql += ' AND a.status = ?'; params.push(status); }
  if (vacancy_id) { sql += ' AND a.vacancy_id = ?'; params.push(vacancy_id); }
  sql += ' ORDER BY a.applied_at DESC LIMIT 500';
  const applications = db.prepare(sql).all(...params);
  const vacancies = db.prepare('SELECT id, title FROM vacancies ORDER BY title ASC').all();
  res.render('admin/applications', { applications, vacancies, query: req.query });
};

// ------------------------------------------------------------ applicant detail / panel summary (4.5)

const renderApplicationDetail = (req, res) => {
  const application = db.prepare(`
    SELECT a.*, u.name AS applicant_name, u.email AS applicant_email, v.title AS vacancy_title, v.department,
           v.category, v.min_qualification, v.min_experience_years, v.pass_mark
    FROM applications a
    JOIN users u ON a.user_id = u.id
    JOIN vacancies v ON a.vacancy_id = v.id
    WHERE a.id = ?`).get(req.params.id);
  if (!application) return res.status(404).render('404');

  const breakdown = academicBreakdown(application);
  const exam = db.prepare('SELECT * FROM exam_results WHERE user_id = ? AND vacancy_id = ?').get(application.user_id, application.vacancy_id);
  const sectionScores = exam && exam.section_scores ? JSON.parse(exam.section_scores) : [];
  res.render('admin-application-detail', {
    application, breakdown, POINTS, exam, sectionScores,
    lists: {
      qualifications: splitLines(application.qualifications_text),
      experience: splitLines(application.experience_text),
      publications: splitLines(application.publications_text),
      seminars: splitLines(application.seminars_text)
    }
  });
};

// HR may adjust the counts (e.g. after verifying documents); points are recalculated from them.
const calculateAcademicScore = (req, res) => {
  const app = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);
  if (!app) return res.status(404).render('404');
  const hq = ['Bachelor', 'Master', 'PhD', 'Other'].includes(req.body.highest_qualification) ? req.body.highest_qualification : app.highest_qualification;
  const data = {
    highest_qualification: hq,
    experience_years: Math.min(60, Math.max(0, toInt(req.body.experience_years, app.experience_years))),
    journal_publications_count: Math.min(500, Math.max(0, toInt(req.body.journal_publications_count, app.journal_publications_count))),
    seminars_attended: Math.min(500, Math.max(0, toInt(req.body.seminars_attended, app.seminars_attended)))
  };
  const total = academicBreakdown(data).total;
  db.prepare(`UPDATE applications SET highest_qualification = ?, experience_years = ?, journal_publications_count = ?,
              seminars_attended = ?, academic_score = ? WHERE id = ?`)
    .run(data.highest_qualification, data.experience_years, data.journal_publications_count, data.seminars_attended, total, app.id);
  logAction(req.session.userId, 'SCORE_CHANGE', `HR re-evaluated academic score for application ID ${app.id}: ${app.academic_score} -> ${total} points.`, req);
  return redirectWith(res, `/admin/applications/${app.id}`, `Academic score updated: ${total} points.`);
};

// ------------------------------------------------------------ interview support (4.6, optional)

const recordInterviewResult = (req, res) => {
  const app = db.prepare('SELECT a.*, v.title FROM applications a JOIN vacancies v ON v.id = a.vacancy_id WHERE a.id = ?').get(req.params.id);
  if (!app) return res.status(404).render('404');
  const back = `/admin/applications/${app.id}`;
  if (!app.shortlisted || !['Shortlisted', 'Recommended'].includes(app.status)) {
    return redirectWith(res, back, 'Interview results can only be recorded for shortlisted candidates.', 'error');
  }
  const score = Number(req.body.interview_score);
  if (!Number.isFinite(score) || score < 0 || score > 100) return redirectWith(res, back, 'Interview score must be between 0 and 100.', 'error');
  const remarks = String(req.body.interviewer_remarks || '').trim().slice(0, 2000);
  const decision = req.body.final_decision;
  const status = decision === 'Recommended' || decision === 'Rejected' ? decision : app.status;

  db.prepare('UPDATE applications SET interview_score = ?, interviewer_remarks = ?, status = ? WHERE id = ?')
    .run(Math.round(score), remarks, status, app.id);
  logAction(req.session.userId, 'INTERVIEW_RECORDED', `Interview score ${Math.round(score)} recorded for application ID ${app.id}; status ${app.status} -> ${status}.`, req);
  if (status !== app.status) {
    notify(app.user_id, status === 'Recommended'
      ? `You have been recommended for "${app.title}" following the interview.`
      : `Your application for "${app.title}" was unsuccessful after the interview stage.`, '/my-applications');
  }
  return redirectWith(res, back, 'Interview evaluation saved.');
};

// ------------------------------------------------------------ shortlisting (4.3)

const runAutoShortlist = (req, res) => {
  const vacancy = db.prepare('SELECT * FROM vacancies WHERE id = ?').get(req.params.id);
  if (!vacancy) return res.status(404).render('404');
  const back = `/vacancies/${vacancy.id}/applications`;
  if (vacancyState(vacancy) !== 'Closed') {
    return redirectWith(res, back, 'Shortlisting can only run after the application deadline (or after closing the recruitment).', 'error');
  }
  const r = shortlistVacancy(vacancy.id, req.session.userId, req);
  return redirectWith(res, back, `Auto-shortlisting complete: ${r.shortlisted} out of ${r.total} pending applicants were shortlisted and notified.`);
};

// ------------------------------------------------------------ exam scheduling (4.4)

const renderExamSettings = (req, res) => {
  const vacancy = db.prepare('SELECT * FROM vacancies WHERE id = ?').get(req.params.id);
  if (!vacancy) return res.status(404).render('404');
  const counts = db.prepare('SELECT section, COUNT(*) AS c FROM questions WHERE vacancy_id = ? GROUP BY section').all(vacancy.id);
  res.render('exam-settings', {
    vacancy, error: null,
    values: { ...vacancy, exam_start: isoToLocalInput(vacancy.exam_start), exam_end: isoToLocalInput(vacancy.exam_end) },
    counts: Object.fromEntries(counts.map((r) => [r.section, r.c]))
  });
};

const saveExamSettings = (req, res) => {
  const vacancy = db.prepare('SELECT * FROM vacancies WHERE id = ?').get(req.params.id);
  if (!vacancy) return res.status(404).render('404');
  if (vacancy.category !== 'non-academic') return redirectWith(res, `/vacancies/${vacancy.id}/applications`, 'Online tests apply to non-academic vacancies only.', 'error');
  const b = req.body;
  const v = {
    exam_start: String(b.exam_start || ''), exam_end: String(b.exam_end || ''),
    aptitude_minutes: toInt(b.aptitude_minutes, 20), literacy_minutes: toInt(b.literacy_minutes, 20),
    aptitude_weight: toInt(b.aptitude_weight, 50), literacy_weight: toInt(b.literacy_weight, 50),
    pass_mark: toInt(b.pass_mark, 50), questions_per_section: toInt(b.questions_per_section, 10)
  };
  const counts = Object.fromEntries(db.prepare('SELECT section, COUNT(*) AS c FROM questions WHERE vacancy_id = ? GROUP BY section').all(vacancy.id).map((r) => [r.section, r.c]));
  const fail = (msg) => res.status(400).render('exam-settings', { vacancy, error: msg, values: v, counts });

  const startIso = localInputToIso(v.exam_start);
  const endIso = localInputToIso(v.exam_end);
  if (!startIso || !endIso) return fail('Please set the exam start and end date/time.');
  if (new Date(endIso) <= new Date(startIso)) return fail('The exam end must be after the start.');
  if (new Date(endIso) < new Date()) return fail('The exam window must end in the future.');
  if (v.aptitude_minutes < 1 || v.aptitude_minutes > 180 || v.literacy_minutes < 1 || v.literacy_minutes > 180) return fail('Section durations must be between 1 and 180 minutes.');
  if (v.aptitude_weight < 0 || v.literacy_weight < 0 || v.aptitude_weight + v.literacy_weight <= 0) return fail('Section weights must be non-negative and not both zero.');
  if (v.pass_mark < 0 || v.pass_mark > 100) return fail('Pass mark must be between 0 and 100.');
  if (v.questions_per_section < 1 || v.questions_per_section > 100) return fail('Questions per section must be between 1 and 100.');
  if (!counts['Aptitude'] && !counts['Computer Literacy']) return fail('Add questions to the question bank before scheduling the exam.');

  db.prepare(`UPDATE vacancies SET exam_start = ?, exam_end = ?, aptitude_minutes = ?, literacy_minutes = ?, aptitude_weight = ?,
              literacy_weight = ?, pass_mark = ?, questions_per_section = ? WHERE id = ?`)
    .run(startIso, endIso, v.aptitude_minutes, v.literacy_minutes, v.aptitude_weight, v.literacy_weight, v.pass_mark, v.questions_per_section, vacancy.id);
  logAction(req.session.userId, 'EXAM_SCHEDULED', `Exam scheduled for vacancy ID ${vacancy.id}: ${fmtDateTime(startIso)} to ${fmtDateTime(endIso)}, pass mark ${v.pass_mark}%.`, req);

  // Tell shortlisted applicants who have not yet taken the exam.
  const targets = db.prepare("SELECT user_id FROM applications WHERE vacancy_id = ? AND status = 'Shortlisted' AND exam_completed = 0").all(vacancy.id);
  targets.forEach((t) => notify(t.user_id,
    `Your aptitude and computer literacy tests for "${vacancy.title}" are scheduled: opens ${fmtDateTime(startIso)}, closes ${fmtDateTime(endIso)}.`, '/my-applications'));
  return redirectWith(res, `/vacancies/${vacancy.id}/applications`, `Exam scheduled. ${targets.length} shortlisted applicant(s) notified.`);
};

// ------------------------------------------------------------ applicant documents (4.2, 4.8)

// Documents are private: only the owning applicant or an admin may download them.
const downloadDocument = (req, res) => {
  const app = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);
  if (!app) return res.status(404).render('404');
  const isAdmin = req.session.role === 'admin';
  if (!isAdmin && app.user_id !== req.session.userId) return res.status(403).render('403');

  const stored = req.params.kind === 'cv' ? app.cv_path : req.params.kind === 'supporting' ? app.supporting_documents_path : null;
  if (!stored) return res.status(404).render('404');
  const name = path.basename(stored); // strips any directory part (including legacy "/uploads/documents/" prefixes)
  const candidates = [path.join(uploadDir, name), path.join(__dirname, '..', 'public', 'uploads', 'documents', name)];
  const file = candidates.find((f) => fs.existsSync(f));
  if (!file) return res.status(404).render('404');

  if (isAdmin) logAction(req.session.userId, 'DOCUMENT_ACCESSED', `Admin opened ${req.params.kind} of application ID ${app.id}.`, req);
  res.set('X-Content-Type-Options', 'nosniff');
  const ext = path.extname(name).toLowerCase();
  const download = `${req.params.kind === 'cv' ? 'CV' : 'Supporting_Documents'}_application_${app.id}${ext}`;
  return res.download(file, download);
};

module.exports = {
  getAllApplications, renderApplicationDetail, calculateAcademicScore, recordInterviewResult,
  runAutoShortlist, renderExamSettings, saveExamSettings, downloadDocument, examState
};
