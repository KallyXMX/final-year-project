const fs = require('fs');
const vacanciesSvc = require('../services/vacancies');
const applicationsSvc = require('../services/applications');
const analytics = require('../services/analytics');
const questionsSvc = require('../services/questions');
const usersSvc = require('../services/users');
const { logAction } = require('../services/audit');
const { notify, listForUser } = require('../services/notifications');
const { vacancyState, examState } = require('../utils/vacancy');
const { endOfLocalDay, todayLocalYmd } = require('../utils/time');
const { academicBreakdown, splitLines } = require('../utils/qualifications');
const { redirectWith, toInt } = require('../utils/http');
const { STATUS, QUALIFICATIONS, CATEGORY } = require('../utils/constants');
const { eligibility } = require('../services/exam');

const YMD = /^\d{4}-\d{2}-\d{2}$/;

const MAX_ENTRIES = 20;
// A repeating field arrives as a string (one box) or an array (several); blank boxes are dropped.
const entryList = (v) => [].concat(v === undefined || v === null ? [] : v)
  .map((s) => String(s).replace(/\s+/g, ' ').trim().slice(0, 300)).filter(Boolean);

const withState = (v) => ({ ...v, state: vacancyState(v), examState: examState(v) });

// ---------------------------------------------------------------- vacancies (4.1)

// Public list: everyone can browse; applicants get an Apply button.
const getAllVacancies = (req, res) => {
  const isAdmin = req.session && req.session.role === 'admin';
  const rows = vacanciesSvc.listWithApplicationCount().map(withState);
  const vacancies = isAdmin ? rows : rows.filter((v) => v.state !== 'Closed' || (req.session && req.session.userId));

  const myApps = req.session && req.session.userId && !isAdmin ? applicationsSvc.statusByVacancy(req.session.userId) : {};
  res.render('vacancies', { vacancies, myApps });
};

const renderCreateForm = (req, res) =>
  res.render('admin/create-vacancy', { error: null, values: { opens_at: todayLocalYmd(), min_qualification: 'Bachelor', min_experience_years: 0, category: 'non-academic' } });

const createVacancy = (req, res) => {
  const b = req.body;
  const values = {
    title: String(b.title || '').trim(),
    department: String(b.department || '').trim(),
    category: b.category === 'academic' ? 'academic' : 'non-academic',
    description: String(b.description || '').trim(),
    requirements: String(b.requirements || '').trim(),
    min_qualification: QUALIFICATIONS.concat(['None']).includes(b.min_qualification) ? b.min_qualification : 'Bachelor',
    min_experience_years: Math.min(60, Math.max(0, toInt(b.min_experience_years, 0))),
    opens_at: String(b.opens_at || '').trim(),
    deadline: String(b.deadline || '').trim()
  };
  const fail = (msg) => res.status(400).render('admin/create-vacancy', { error: msg, values });

  if (!values.title || !values.department) return fail('Title and department are required.');
  if (values.title.length > 150 || values.department.length > 150) return fail('Title / department is too long.');
  if (!YMD.test(values.deadline)) return fail('A valid application deadline is required.');
  if (!YMD.test(values.opens_at)) values.opens_at = todayLocalYmd();
  if (values.deadline < values.opens_at) return fail('The deadline cannot be before the opening date.');
  if (endOfLocalDay(values.deadline) < new Date()) return fail('The deadline must be today or a future date.');

  const info = vacanciesSvc.create(values);
  logAction(req.session.userId, 'VACANCY_CREATED', `Created new ${values.category} vacancy: ${values.title} (ID ${info.lastInsertRowid}).`, req);
  return redirectWith(res, '/vacancies', 'Vacancy published. Applications open automatically on the opening date and close after the deadline.');
};

const closeVacancy = (req, res) => {
  const v = vacanciesSvc.findById(req.params.id);
  if (!v) return res.status(404).render('404');
  vacanciesSvc.setClosedAt(v.id, new Date().toISOString());
  logAction(req.session.userId, 'VACANCY_CLOSED', `Closed recruitment early for vacancy ID ${v.id} (${v.title}).`, req);
  return redirectWith(res, `/vacancies/${v.id}/applications`, 'Recruitment closed. Auto-shortlisting will run now or within a minute.');
};

const reopenVacancy = (req, res) => {
  const v = vacanciesSvc.findById(req.params.id);
  if (!v) return res.status(404).render('404');
  if (v.shortlisted_at) return redirectWith(res, `/vacancies/${v.id}/applications`, 'Shortlisting has already been done; the vacancy cannot be reopened.', 'error');
  if (v.deadline && endOfLocalDay(v.deadline) < new Date()) return redirectWith(res, `/vacancies/${v.id}/applications`, 'The deadline has passed; the vacancy closed automatically.', 'error');
  vacanciesSvc.setClosedAt(v.id, null);
  logAction(req.session.userId, 'VACANCY_REOPENED', `Reopened vacancy ID ${v.id} (${v.title}).`, req);
  return redirectWith(res, `/vacancies/${v.id}/applications`, 'Recruitment reopened.');
};

// ---------------------------------------------------------------- applying (4.2)

const loadOpenVacancy = (id) => {
  const v = vacanciesSvc.findActiveById(id);
  return v ? withState(v) : null;
};

const renderApplyForm = (req, res) => {
  const vacancy = loadOpenVacancy(req.params.id);
  if (!vacancy) return res.status(404).render('404');
  if (applicationsSvc.findByUserAndVacancy(req.session.userId, vacancy.id)) {
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

  if (applicationsSvc.findByUserAndVacancy(userId, vacancy.id)) {
    removeUploaded(req.files);
    return redirectWith(res, '/my-applications', 'You have already applied for this vacancy.', 'error');
  }
  // Applications are accepted only before the stated deadline (Requirement 2.2 / 2.3).
  if (vacancy.state !== 'Open') {
    removeUploaded(req.files);
    return redirectWith(res, '/vacancies', 'Application closed: this vacancy is not open for applications.', 'error');
  }

  const b = req.body || {};
  const lists = {};
  for (const k of ['qualifications_text', 'experience_text', 'publications_text', 'seminars_text']) {
    lists[k] = entryList(b[k + '[]'] !== undefined ? b[k + '[]'] : b[k]);
  }
  const values = {
    phone: String(b.phone || '').trim(),
    address: String(b.address || '').trim(),
    highest_qualification: String(b.highest_qualification || ''),
    experience_years: toInt(b.experience_years, 0),
    qualifications_text: lists.qualifications_text.join('\n'),
    experience_text: lists.experience_text.join('\n'),
    publications_text: lists.publications_text.join('\n'),
    seminars_text: lists.seminars_text.join('\n')
  };
  const fail = (msg) => { removeUploaded(req.files); return res.status(400).render('apply', { vacancy, error: msg, values }); };

  if (Object.values(lists).some((l) => l.length > MAX_ENTRIES)) return fail(`You can add at most ${MAX_ENTRIES} entries per section.`);
  if (!/^[+\d][\d\s\-()]{6,19}$/.test(values.phone)) return fail('Please enter a valid phone number.');
  if (values.address.length < 5 || values.address.length > 300) return fail('Please enter your contact address.');
  if (!QUALIFICATIONS.includes(values.highest_qualification)) return fail('Please select your highest qualification.');
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
    applicationsSvc.insert({
      user_id: userId, vacancy_id: vacancy.id, ...values,
      publications_text: academic ? values.publications_text : '', seminars_text: academic ? values.seminars_text : '',
      journal_publications_count: publications, seminars_attended: seminars, academic_score: score,
      cv_path: cv.filename, supporting_documents_path: docs.filename
    });
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
  const rows = applicationsSvc.listForUser(req.session.userId);

  const applications = rows.map((a) => {
    const vac = { ...a, id: a.vid };
    const elig = a.category === CATEGORY.NON_ACADEMIC && a.status === STATUS.SHORTLISTED ? eligibility(a, vac) : { ok: false };
    return { ...a, vacancyState: vacancyState(vac), examState: examState(vac), canTakeExam: elig.ok, examNote: elig.reason };
  });
  res.render('my-applications', { applications });
};

// ---------------------------------------------------------------- HR: applicants of one vacancy (4.1)

const viewVacancyApplications = (req, res) => {
  const vacancy = vacanciesSvc.findById(req.params.id);
  if (!vacancy) return res.status(404).render('404');
  const applications = applicationsSvc.listForVacancy(vacancy.id);
  const pending = applications.filter((a) => a.status === STATUS.PENDING).length;
  const questionCount = questionsSvc.countForVacancy(vacancy.id);
  res.render('admin/vacancy-applicants', { applications, vacancy: withState(vacancy), pending, questionCount });
};

// Final HR decision after the interview stage (Requirement 2.8)
const updateApplicationStatus = (req, res) => {
  const { status } = req.body;
  if (![STATUS.ACCEPTED, STATUS.REJECTED].includes(status)) return res.status(400).render('500', { message: 'Invalid status. Must be "Accepted" or "Rejected".' });
  const app = applicationsSvc.findWithVacancyTitle(req.params.applicationId);
  if (!app) return res.status(404).render('404');
  const back = `/vacancies/${app.vacancy_id}/applications`;
  if (status === STATUS.ACCEPTED && ![STATUS.SHORTLISTED, STATUS.RECOMMENDED].includes(app.status)) {
    return redirectWith(res, back, 'Only shortlisted or recommended candidates can be accepted.', 'error');
  }
  applicationsSvc.setStatus(app.id, status);
  logAction(req.session.userId, 'STATUS_CHANGE', `Application ID ${app.id} changed from ${app.status} to ${status}.`, req);
  notify(app.user_id, status === STATUS.ACCEPTED
    ? `Congratulations! You have been selected for "${app.title}". HR will contact you about the appointment.`
    : `Your application for "${app.title}" was unsuccessful. Thank you for your interest.`, '/my-applications');
  return redirectWith(res, back, `Application ${status.toLowerCase()}.`);
};

// ---------------------------------------------------------------- dashboard + analytics (6.3)

const getDashboard = (req, res) => {
  const userData = usersSvc.findProfile(req.session.userId);
  if (!userData) return res.redirect('/login');

  if (userData.role === 'admin') {
    return res.render('dashboard', { user: userData, analytics: analytics.adminDashboard(), myApplications: [] });
  }
  const myApplications = applicationsSvc.listForDashboard(userData.id);
  const notifications = listForUser(userData.id, 5);
  return res.render('dashboard', { user: userData, analytics: null, myApplications, notifications });
};

module.exports = {
  getAllVacancies, renderCreateForm, createVacancy, closeVacancy, reopenVacancy,
  renderApplyForm, applyToVacancy, getMyApplications, viewVacancyApplications,
  updateApplicationStatus, getDashboard
};
