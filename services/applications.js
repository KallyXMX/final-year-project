// Data access for applications (Requirements 4.1, 4.2, 4.5, 4.6). Controllers call these instead of writing SQL.
const db = require('../models/db');
const { STATUS } = require('../utils/constants');

const findById = (id) => db.prepare('SELECT * FROM applications WHERE id = ?').get(id);

const findByUserAndVacancy = (userId, vacancyId) =>
  db.prepare('SELECT * FROM applications WHERE user_id = ? AND vacancy_id = ?').get(userId, vacancyId);

const findWithVacancyTitle = (id) =>
  db.prepare('SELECT a.*, v.title FROM applications a JOIN vacancies v ON v.id = a.vacancy_id WHERE a.id = ?').get(id);

// { vacancyId: status } for the vacancies an applicant has already applied to.
const statusByVacancy = (userId) => {
  const map = {};
  db.prepare('SELECT vacancy_id, status FROM applications WHERE user_id = ?').all(userId)
    .forEach((a) => { map[a.vacancy_id] = a.status; });
  return map;
};

// Throws SQLITE_CONSTRAINT_UNIQUE if the applicant already applied to this vacancy.
const insert = (a) => db.prepare(`
  INSERT INTO applications
    (user_id, vacancy_id, status, phone, address, highest_qualification, experience_years, qualifications_text, experience_text,
     publications_text, seminars_text, journal_publications_count, seminars_attended, academic_score, cv_path, supporting_documents_path)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
  a.user_id, a.vacancy_id, STATUS.PENDING, a.phone, a.address, a.highest_qualification, a.experience_years,
  a.qualifications_text, a.experience_text, a.publications_text, a.seminars_text,
  a.journal_publications_count, a.seminars_attended, a.academic_score, a.cv_path, a.supporting_documents_path);

// Applicant's own list, with the exam result when there is one.
const listForUser = (userId) => db.prepare(`
  SELECT a.*, v.title AS job_title, v.department, v.category, v.deadline, v.exam_start, v.exam_end, v.pass_mark, v.shortlisted_at,
         v.opens_at, v.closed_at, v.id AS vid, v.academic_exam_enabled,
         er.score AS exam_correct, er.total_questions AS exam_total, er.percentage AS exam_pct, er.passed AS exam_passed
  FROM applications a
  JOIN vacancies v ON v.id = a.vacancy_id
  LEFT JOIN exam_results er ON er.user_id = a.user_id AND er.vacancy_id = a.vacancy_id
  WHERE a.user_id = ? ORDER BY a.applied_at DESC, a.id DESC`).all(userId);

// Short list for the applicant dashboard.
const listForDashboard = (userId) => db.prepare(`
  SELECT a.*, v.title AS vacancy_title, v.category, v.academic_exam_enabled FROM applications a JOIN vacancies v ON a.vacancy_id = v.id
  WHERE a.user_id = ? ORDER BY a.applied_at DESC`).all(userId);

// HR view: every applicant of one vacancy.
const listForVacancy = (vacancyId) => db.prepare(`
  SELECT a.*, u.name AS applicant_name, u.email AS applicant_email,
         er.score, er.total_questions, er.percentage, er.passed
  FROM applications a
  JOIN users u ON a.user_id = u.id
  LEFT JOIN exam_results er ON er.user_id = a.user_id AND er.vacancy_id = a.vacancy_id
  WHERE a.vacancy_id = ?
  ORDER BY a.applied_at DESC`).all(vacancyId);

// HR search / filter across all vacancies (Requirement 4.1).
const search = ({ search: text, status, vacancy_id: vacancyId }) => {
  let sql = `
    SELECT a.*, u.name AS applicant_name, u.email AS applicant_email, v.title AS vacancy_title, v.category,
           er.score, er.total_questions, er.percentage
    FROM applications a
    JOIN users u ON a.user_id = u.id
    JOIN vacancies v ON a.vacancy_id = v.id
    LEFT JOIN exam_results er ON er.user_id = a.user_id AND er.vacancy_id = a.vacancy_id
    WHERE 1=1`;
  const params = [];
  if (text) { sql += ' AND (u.name LIKE ? OR u.email LIKE ?)'; params.push(`%${text}%`, `%${text}%`); }
  if (status) { sql += ' AND a.status = ?'; params.push(status); }
  if (vacancyId) { sql += ' AND a.vacancy_id = ?'; params.push(vacancyId); }
  sql += ' ORDER BY a.applied_at DESC LIMIT 500';
  return db.prepare(sql).all(...params);
};

// One application with applicant and vacancy details (qualification summary for the panel, Requirement 4.5).
const findDetail = (id) => db.prepare(`
  SELECT a.*, u.name AS applicant_name, u.email AS applicant_email, v.title AS vacancy_title, v.department,
         v.category, v.min_qualification, v.min_experience_years, v.pass_mark, v.academic_exam_enabled,
         v.pts_phd, v.pts_master, v.pts_bachelor, v.pts_per_year, v.pts_per_publication, v.pts_per_seminar
  FROM applications a
  JOIN users u ON a.user_id = u.id
  JOIN vacancies v ON a.vacancy_id = v.id
  WHERE a.id = ?`).get(id);

const countPending = (vacancyId) =>
  db.prepare('SELECT COUNT(*) AS c FROM applications WHERE vacancy_id = ? AND status = ?').get(vacancyId, STATUS.PENDING).c;

const setStatus = (id, status) => db.prepare('UPDATE applications SET status = ? WHERE id = ?').run(status, id);

// HR corrects the figures after checking documents; the total is recalculated by the caller.
const updateAcademicFigures = (id, d, total) => db.prepare(`
  UPDATE applications SET highest_qualification = ?, experience_years = ?, journal_publications_count = ?,
  seminars_attended = ?, academic_score = ? WHERE id = ?`)
  .run(d.highest_qualification, d.experience_years, d.journal_publications_count, d.seminars_attended, total, id);

// Recalculate every academic score of one vacancy with `scoreOf(application)`; returns how many changed.
const rescoreVacancy = (vacancyId, scoreOf) => {
  const rows = db.prepare('SELECT * FROM applications WHERE vacancy_id = ?').all(vacancyId);
  const upd = db.prepare('UPDATE applications SET academic_score = ? WHERE id = ?');
  let changed = 0;
  for (const r of rows) { const t = scoreOf(r); if (t !== r.academic_score) { upd.run(t, r.id); changed++; } }
  return changed;
};

const saveInterview = (id, score, remarks, status) =>
  db.prepare('UPDATE applications SET interview_score = ?, interviewer_remarks = ?, status = ? WHERE id = ?').run(score, remarks, status, id);

// Shortlisted applicants who still have to sit the exam (used to notify them when it is scheduled).
const awaitingExam = (vacancyId) => db.prepare(
  'SELECT user_id FROM applications WHERE vacancy_id = ? AND status = ? AND exam_completed = 0').all(vacancyId, STATUS.SHORTLISTED);

const findExamResult = (userId, vacancyId) =>
  db.prepare('SELECT * FROM exam_results WHERE user_id = ? AND vacancy_id = ?').get(userId, vacancyId);

module.exports = {
  findById, findByUserAndVacancy, findWithVacancyTitle, statusByVacancy, insert, listForUser, listForDashboard,
  listForVacancy, search, findDetail, countPending, setStatus, updateAcademicFigures, rescoreVacancy, saveInterview, awaitingExam, findExamResult
};
