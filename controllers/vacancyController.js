const fs = require('fs');
const db = require('../models/db');
const { logAction } = require('../services/audit');
const { notify } = require('../services/notifications');
const { vacancyState, examState } = require('../utils/vacancy');
const { endOfLocalDay, startOfLocalDay, todayLocalYmd } = require('../utils/time');
const { academicBreakdown, splitLines, LEVELS } = require('../utils/qualifications');
const { redirectWith, toInt } = require('../utils/http');
const { eligibility } = require('../services/exam');

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const QUALS = ['Bachelor', 'Master', 'PhD', 'Other'];

const withState = (v) => ({ ...v, state: vacancyState(v), examState: examState(v) });

// ---------------------------------------------------------------- vacancies (4.1)

// Public list: everyone can browse; applicants get an Apply button.
const getAllVacancies = (req, res) => {
  const isAdmin = req.session && req.session.role === 'admin';
  const rows = db.prepare(`
    SELECT v.*, (SELECT COUNT(*) FROM applications a WHERE a.vacancy_id = v.id) AS application_count
    FROM vacancies v WHERE v.is_active = 1 ORDER BY v.created_at DESC, v.id DESC`).all().map(withState);
  const vacancies = isAdmin ? rows : rows.filter((v) => v.state !== 'Closed' || (req.session && req.session.userId));

  const myApps = {};
  if (req.session && req.session.userId && !isAdmin) {
    db.prepare('SELECT vacancy_id, status FROM applications WHERE user_id = ?').all(req.session.userId)
      .forEach((a) => { myApps[a.vacancy_id] = a.status; });
  }
  res.render('vacancies', { vacancies, myApps });
};

const renderCreateForm = (req, res) =>
  res.render('create-vacancy', { error: null, values: { opens_at: todayLocalYmd(), min_qualification: 'Bachelor', min_experience_years: 0, category: 'non-academic' } });

const createVacancy = (req, res) => {
  const b = req.body;
  const values = {
    title: String(b.title || '').trim(),
    department: String(b.department || '').trim(),
    category: b.category === 'academic' ? 'academic' : 'non-academic',
    description: String(b.description || '').trim(),
    requirements: String(b.requirements || '').trim(),
    min_qualification: QUALS.concat(['None']).includes(b.min_qualification) ? b.min_qualification : 'Bachelor',
    min_experience_years: Math.min(60, Math.max(0, toInt(b.min_experience_years, 0))),
    opens_at: String(b.opens_at || '').trim(),
    deadline: String(b.deadline || '').trim()
  };
  const fail = (msg) => res.status(400).render('create-vacancy', { error: msg, values });

  if (!values.title || !values.department) return fail('Title and department are required.');
  if (values.title.length > 150 || values.department.length > 150) return fail('Title / department is too long.');
  if (!YMD.test(values.deadline)) return fail('A valid application deadline is required.');
  if (!YMD.test(values.opens_at)) values.opens_at = todayLocalYmd();
  if (values.deadline < values.opens_at) return fail('The deadline cannot be before the opening date.');
  if (endOfLocalDay(values.deadline) < new Date()) return fail('The deadline must be today or a future date.');

  const info = db.prepare(`
    INSERT INTO vacancies (title, department, category, description, requirements, min_qualification, min_experience_years, opens_at, deadline)
    VALUES (@title, @department, @category, @description, @requirements, @min_qualification, @min_experience_years, @opens_at, @deadline)`).run(values);
  logAction(req.session.userId, 'VACANCY_CREATED', `Created new ${values.category} vacancy: ${values.title} (ID ${info.lastInsertRowid}).`, req);
  return redirectWith(res, '/vacancies', 'Vacancy published. Applications open automatically on the opening date and close after the deadline.');
};

const closeVacancy = (req, res) => {
  const v = db.prepare('SELECT * FROM vacancies WHERE id = ?').get(req.params.id);
  if (!v) return res.status(404).render('404');
  db.prepare('UPDATE vacancies SET closed_at = ? WHERE id = ?').run(new Date().toISOString(), v.id);
  logAction(req.session.userId, 'VACANCY_CLOSED', `Closed recruitment early for vacancy ID ${v.id} (${v.title}).`, req);
  return redirectWith(res, `/vacancies/${v.id}/applications`, 'Recruitment closed. Auto-shortlisting will run now or within a minute.');
};

const reopenVacancy = (req, res) => {
  const v = db.prepare('SELECT * FROM vacancies WHERE id = ?').get(req.params.id);
  if (!v) return res.status(404).render('404');
  if (v.shortlisted_at) return redirectWith(res, `/vacancies/${v.id}/applications`, 'Shortlisting has already been done; the vacancy cannot be reopened.', 'error');
  if (v.deadline && endOfLocalDay(v.deadline) < new Date()) return redirectWith(res, `/vacancies/${v.id}/applications`, 'The deadline has passed; the vacancy closed automatically.', 'error');
  db.prepare('UPDATE vacancies SET closed_at = NULL WHERE id = ?').run(v.id);
  logAction(req.session.userId, 'VACANCY_REOPENED', `Reopened vacancy ID ${v.id} (${v.title}).`, req);
  return redirectWith(res, `/vacancies/${v.id}/applications`, 'Recruitment reopened.');
};

// ---------------------------------------------------------------- applying (4.2)

const loadOpenVacancy = (id) => {
  const v = db.prepare('SELECT * FROM vacancies WHERE id = ? AND is_active = 1').get(id);
  return v ? withState(v) : null;
};

const renderApplyForm = (req, res) => {
  const vacancy = loadOpenVacancy(req.params.id);
  if (!vacancy) return res.status(404).render('404');
  if (db.prepare('SELECT id FROM applications WHERE user_id = ? AND vacancy_id = ?').get(req.session.userId, vacancy.id)) {
    return redirectWith(res, '/my-applications', 'You have already applied for this vacancy.', 'error');
  }
  if (vacancy.state !== 'Open') {
    return redirectWith(res, '/vacancies', vacancy.state === 'Upcoming' ? 'Applications for this vacancy have not opened yet.' : 'Application closed: the deadline for this vacancy has passed.', 'error');
  }
  res.render('apply', { vacancy, error: null, values: {} });
};

const removeUploaded = (files) => {
  if (!files) return;
  Object.values(files).flat().forEach((f) => { try { fs.unlinkSync(f.path); } catch (e) { /* already gone */ } });
};

const applyToVacancy = (req, res) => {
  const userId = req.session.userId;
  const vacancy = loadOpenVacancy(req.params.id);
  if (!vacancy) { removeUploaded(req.files); return res.status(404).render('404'); }

  if (db.prepare('SELECT id FROM applications WHERE user_id = ? AND vacancy_id = ?').get(userId, vacancy.id)) {
    removeUploaded(req.files);
    return redirectWith(res, '/my-applications', 'You have already applied for this vacancy.', 'error');
  }
  // Applications are accepted only before the stated deadline (Requirement 2.2 / 2.3).
  if (vacancy.state !== 'Open') {
    removeUploaded(req.files);
    return redirectWith(res, '/vacancies', 'Application closed: this vacancy is not open for applications.', 'error');
  }

  const b = req.body || {};
  const values = {
    phone: String(b.phone || '').trim(),
    address: String(b.address || '').trim(),
    highest_qualification: String(b.highest_qualification || ''),
    experience_years: toInt(b.experience_years, 0),
    qualifications_text: String(b.qualifications_text || '').trim().slice(0, 4000),
    experience_text: String(b.experience_text || '').trim().slice(0, 4000),
    publications_text: String(b.publications_text || '').trim().slice(0, 4000),
    seminars_text: String(b.seminars_text || '').trim().slice(0, 4000)
  };
  const fail = (msg) => { removeUploaded(req.files); return res.status(400).render('apply', { vacancy, error: msg, values }); };

  if (!/^[+\d][\d\s\-()]{6,19}$/.test(values.phone)) return fail('Please enter a valid phone number.');
  if (values.address.length < 5 || values.address.length > 300) return fail('Please enter your contact address.');
  if (!QUALS.includes(values.highest_qualification)) return fail('Please select your highest qualification.');
  if (values.experience_years < 0 || values.experience_years > 60) return fail('Years of experience must be between 0 and 60.');
  if (values.qualifications_text.length < 3) return fail('Please list your academic qualifications.');
  const cv = req.files && req.files.cv && req.files.cv[0];
  const docs = req.files && req.files.supporting_docs && req.files.supporting_docs[0];
  if (!cv) return fail('Please upload your CV.');
  if (!docs) return fail('Please upload your supporting documents (certificates etc.).');

  const academic = vacancy.category === 'academic';
  const publications = academic ? splitLines(values.publications_text).length : 0;
  const seminars = academic ? splitLines(values.seminars_text).length : 0;
  const score = academic
    ? academicBreakdown({ highest_qualification: values.highest_qualification, experience_years: values.experience_years, journal_publications_count: publications, seminars_attended: seminars }).total
    : 0;

  try {
    db.prepare(`
      INSERT INTO applications
        (user_id, vacancy_id, status, phone, address, highest_qualification, experience_years, qualifications_text, experience_text,
         publications_text, seminars_text, journal_publications_count, seminars_attended, academic_score, cv_path, supporting_documents_path)
      VALUES (?, ?, 'Pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      userId, vacancy.id, values.phone, values.address, values.highest_qualification, values.experience_years,
      values.qualifications_text, values.experience_text,
      academic ? values.publications_text : '', academic ? values.seminars_text : '',
      publications, seminars, score, cv.filename, docs.filename);
  } catch (e) {
    removeUploaded(req.files);
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return redirectWith(res, '/my-applications', 'You have already applied for this vacancy.', 'error');
    throw e;
  }

  logAction(userId, 'APPLICATION_SUBMITTED', `Applicant submitted an application for "${vacancy.title}" (vacancy ID ${vacancy.id}).`, req);
  notify(userId, `Your application for "${vacancy.title}" was received. You will be notified after the closing date (${vacancy.deadline}) about shortlisting.`, '/my-applications');
  return redirectWith(res, '/my-applications', 'Application submitted successfully!');
};

// ---------------------------------------------------------------- tracking (4.2)

const getMyApplications = (req, res) => {
  const rows = db.prepare(`
    SELECT a.*, v.title AS job_title, v.department, v.category, v.deadline, v.exam_start, v.exam_end, v.pass_mark, v.shortlisted_at,
           v.opens_at, v.closed_at, v.id AS vid,
           er.score AS exam_correct, er.total_questions AS exam_total, er.percentage AS exam_pct, er.passed AS exam_passed
    FROM applications a
    JOIN vacancies v ON v.id = a.vacancy_id
    LEFT JOIN exam_results er ON er.user_id = a.user_id AND er.vacancy_id = a.vacancy_id
    WHERE a.user_id = ? ORDER BY a.applied_at DESC, a.id DESC`).all(req.session.userId);

  const applications = rows.map((a) => {
    const vac = { ...a, id: a.vid };
    const elig = a.category === 'non-academic' && a.status === 'Shortlisted' ? eligibility(a, vac) : { ok: false };
    return { ...a, vacancyState: vacancyState(vac), examState: examState(vac), canTakeExam: elig.ok, examNote: elig.reason };
  });
  res.render('my-applications', { applications });
};

// ---------------------------------------------------------------- HR: applicants of one vacancy (4.1)

const viewVacancyApplications = (req, res) => {
  const vacancy = db.prepare('SELECT * FROM vacancies WHERE id = ?').get(req.params.id);
  if (!vacancy) return res.status(404).render('404');
  const applications = db.prepare(`
    SELECT a.*, u.name AS applicant_name, u.email AS applicant_email,
           er.score, er.total_questions, er.percentage, er.passed
    FROM applications a
    JOIN users u ON a.user_id = u.id
    LEFT JOIN exam_results er ON er.user_id = a.user_id AND er.vacancy_id = a.vacancy_id
    WHERE a.vacancy_id = ?
    ORDER BY a.applied_at DESC`).all(vacancy.id);
  const pending = applications.filter((a) => a.status === 'Pending').length;
  const questionCount = db.prepare('SELECT COUNT(*) AS c FROM questions WHERE vacancy_id = ?').get(vacancy.id).c;
  res.render('admin-applications', { applications, vacancy: withState(vacancy), pending, questionCount });
};

// Final HR decision after the interview stage (Requirement 2.8)
const updateApplicationStatus = (req, res) => {
  const { status } = req.body;
  if (!['Accepted', 'Rejected'].includes(status)) return res.status(400).render('500', { message: 'Invalid status. Must be "Accepted" or "Rejected".' });
  const app = db.prepare('SELECT a.*, v.title FROM applications a JOIN vacancies v ON v.id = a.vacancy_id WHERE a.id = ?').get(req.params.applicationId);
  if (!app) return res.status(404).render('404');
  const back = `/vacancies/${app.vacancy_id}/applications`;
  if (status === 'Accepted' && !['Shortlisted', 'Recommended'].includes(app.status)) {
    return redirectWith(res, back, 'Only shortlisted or recommended candidates can be accepted.', 'error');
  }
  db.prepare('UPDATE applications SET status = ? WHERE id = ?').run(status, app.id);
  logAction(req.session.userId, 'STATUS_CHANGE', `Application ID ${app.id} changed from ${app.status} to ${status}.`, req);
  notify(app.user_id, status === 'Accepted'
    ? `Congratulations! You have been selected for "${app.title}". HR will contact you about the appointment.`
    : `Your application for "${app.title}" was unsuccessful. Thank you for your interest.`, '/my-applications');
  return redirectWith(res, back, `Application ${status.toLowerCase()}.`);
};

// ---------------------------------------------------------------- dashboard + analytics (6.3)

const getDashboard = (req, res) => {
  const userData = db.prepare('SELECT id, name, email, role, created_at FROM users WHERE id = ?').get(req.session.userId);
  if (!userData) return res.redirect('/login');

  if (userData.role === 'admin') {
    const count = (sql, ...p) => db.prepare(sql).get(...p).c;
    const statusRows = db.prepare('SELECT status, COUNT(*) AS count FROM applications GROUP BY status').all();
    const statusCounts = { Pending: 0, Shortlisted: 0, Recommended: 0, Accepted: 0, Rejected: 0 };
    statusRows.forEach((r) => { if (r.status in statusCounts) statusCounts[r.status] = r.count; });
    const avg = db.prepare('SELECT AVG(percentage) AS a FROM exam_results').get().a;
    const perVacancy = db.prepare(`
      SELECT v.title, COUNT(a.id) AS apps FROM vacancies v LEFT JOIN applications a ON a.vacancy_id = v.id
      WHERE v.is_active = 1 GROUP BY v.id ORDER BY v.id DESC LIMIT 8`).all();
    const exam = db.prepare('SELECT SUM(passed) AS passed, COUNT(*) AS total FROM exam_results').get();
    const vacancies = db.prepare('SELECT * FROM vacancies WHERE is_active = 1').all().map(withState);

    const analytics = {
      totalUsers: count("SELECT COUNT(*) AS c FROM users WHERE role = 'applicant'"),
      totalVacancies: vacancies.filter((v) => v.state === 'Open').length,
      totalApplications: count('SELECT COUNT(*) AS c FROM applications'),
      averageScore: avg ? avg.toFixed(1) : '0',
      statusCounts,
      perVacancy,
      examOutcome: { passed: exam.passed || 0, failed: (exam.total || 0) - (exam.passed || 0) },
      awaitingShortlist: vacancies.filter((v) => v.state === 'Closed' && !v.shortlisted_at).length
    };
    return res.render('dashboard', { user: userData, analytics, myApplications: [] });
  }

  const myApplications = db.prepare(`
    SELECT a.*, v.title AS vacancy_title, v.category FROM applications a JOIN vacancies v ON a.vacancy_id = v.id
    WHERE a.user_id = ? ORDER BY a.applied_at DESC`).all(userData.id);
  const notifications = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 5').all(userData.id);
  return res.render('dashboard', { user: userData, analytics: null, myApplications, notifications });
};

module.exports = {
  getAllVacancies, renderCreateForm, createVacancy, closeVacancy, reopenVacancy,
  renderApplyForm, applyToVacancy, getMyApplications, viewVacancyApplications,
  updateApplicationStatus, getDashboard, LEVELS
};
