const db = require('../models/db');
const { logAction } = require('../services/audit');
const exam = require('../services/exam');
const { redirectWith } = require('../utils/http');

const loadContext = (req) => {
  const vacancy = db.prepare('SELECT * FROM vacancies WHERE id = ?').get(req.params.vacancyId);
  const application = vacancy
    ? db.prepare('SELECT * FROM applications WHERE user_id = ? AND vacancy_id = ?').get(req.session.userId, vacancy.id)
    : null;
  return { vacancy, application };
};

// GET /exam/:vacancyId - instructions page, or the current section if an attempt is running.
const renderExamPage = (req, res) => {
  const { vacancy, application } = loadContext(req);
  if (!vacancy) return res.status(404).render('404');
  if (!application) return redirectWith(res, '/my-applications', 'You have not applied for this vacancy.', 'error');

  let attempt = exam.loadAttempt(application.id);
  if (attempt) attempt = exam.advance(attempt); // auto-submit any section whose time ran out
  if (attempt && attempt.finished_at) return res.redirect(`/exam/${vacancy.id}/result`);

  if (!attempt) {
    const elig = exam.eligibility(application, vacancy);
    if (!elig.ok) {
      if (application.exam_completed) return res.redirect(`/exam/${vacancy.id}/result`);
      return redirectWith(res, '/my-applications', elig.reason, 'error');
    }
    const counts = db.prepare('SELECT section, COUNT(*) AS c FROM questions WHERE vacancy_id = ? GROUP BY section').all(vacancy.id);
    return res.render('exam-intro', {
      vacancy,
      sections: exam.sectionConfig(vacancy).map((s) => ({ ...s, available: (counts.find((c) => c.section === s.name) || {}).c || 0 })),
      perSection: vacancy.questions_per_section || 10
    });
  }

  const view = exam.currentSectionView(attempt);
  return res.render('exam', { vacancy, view });
};

// POST /exam/:vacancyId/start
const startExam = (req, res) => {
  const { vacancy, application } = loadContext(req);
  if (!vacancy || !application) return res.status(404).render('404');
  if (exam.loadAttempt(application.id)) return res.redirect(`/exam/${vacancy.id}`);
  const elig = exam.eligibility(application, vacancy);
  if (!elig.ok) return redirectWith(res, '/my-applications', elig.reason, 'error');
  const attempt = exam.createAttempt(application, vacancy);
  if (!attempt) return redirectWith(res, '/my-applications', 'The examination has no questions yet. Please contact HR.', 'error');
  logAction(req.session.userId, 'EXAM_STARTED', `Applicant started the CBT exam for vacancy ID ${vacancy.id}.`, req);
  return res.redirect(`/exam/${vacancy.id}`);
};

// POST /exam/:vacancyId/submit - submits the current section (also called on timeout)
const submitExam = (req, res) => {
  const { vacancy, application } = loadContext(req);
  if (!vacancy || !application) return res.status(404).render('404');
  const attempt = exam.loadAttempt(application.id);
  if (!attempt) return res.redirect(`/exam/${vacancy.id}`);
  const after = exam.submitSection(attempt, parseInt(req.body.section_index, 10), req.body || {});
  if (after.finished_at) return res.redirect(`/exam/${vacancy.id}/result`);
  return res.redirect(`/exam/${vacancy.id}`);
};

// GET /exam/:vacancyId/result
const renderResult = (req, res) => {
  const { vacancy, application } = loadContext(req);
  if (!vacancy || !application) return res.status(404).render('404');
  const attempt = exam.loadAttempt(application.id);
  if (attempt && !attempt.finished_at) return res.redirect(`/exam/${vacancy.id}`);
  const result = db.prepare('SELECT * FROM exam_results WHERE user_id = ? AND vacancy_id = ?').get(req.session.userId, vacancy.id);
  if (!result) return redirectWith(res, '/my-applications', 'No examination result is available yet.', 'error');
  res.render('exam_result', {
    vacancy, result, sections: result.section_scores ? JSON.parse(result.section_scores) : [], passMark: vacancy.pass_mark ?? 50
  });
};

// ---------------------------------------------------------------- question bank (admin)

const renderQuestionBank = (req, res) => {
  const vacancy = db.prepare('SELECT * FROM vacancies WHERE id = ?').get(req.params.id);
  if (!vacancy) return res.status(404).render('404');
  const questions = db.prepare('SELECT * FROM questions WHERE vacancy_id = ? ORDER BY section, id').all(vacancy.id);
  res.render('create-question', { vacancy, questions, error: null, values: {} });
};

const nonAcademicVacancies = () => db.prepare("SELECT id, title FROM vacancies WHERE category = 'non-academic' ORDER BY title").all();

const questionIndex = (req, res) => {
  const list = nonAcademicVacancies();
  if (list.length === 0) return redirectWith(res, '/vacancies', 'Create a non-academic vacancy first; online tests apply to those.', 'error');
  return res.redirect(`/admin/vacancies/${req.query.vacancy_id || list[0].id}/questions`);
};

const createQuestion = (req, res) => {
  const b = req.body;
  const vacancyId = parseInt(b.vacancy_id, 10);
  const vacancy = db.prepare('SELECT * FROM vacancies WHERE id = ?').get(vacancyId);
  if (!vacancy) return res.status(404).render('404');
  const questions = db.prepare('SELECT * FROM questions WHERE vacancy_id = ? ORDER BY section, id').all(vacancy.id);
  const values = {
    section: b.section, question_text: String(b.question_text || '').trim(),
    option_a: String(b.option_a || '').trim(), option_b: String(b.option_b || '').trim(),
    option_c: String(b.option_c || '').trim(), option_d: String(b.option_d || '').trim(),
    correct_option: String(b.correct_option || '').trim().toUpperCase()
  };
  const fail = (msg) => res.status(400).render('create-question', { vacancy, questions, error: msg, values });

  if (vacancy.category !== 'non-academic') return fail('Online tests apply to non-academic vacancies only.');
  if (!exam.SECTIONS.includes(values.section)) return fail('Please choose a section.');
  if (!values.question_text || !values.option_a || !values.option_b || !values.option_c || !values.option_d) return fail('The question and all four options are required.');
  if (!['A', 'B', 'C', 'D'].includes(values.correct_option)) return fail('Please select the correct option.');

  db.prepare(`INSERT INTO questions (vacancy_id, section, question_text, option_a, option_b, option_c, option_d, correct_option)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(vacancy.id, values.section, values.question_text, values.option_a, values.option_b, values.option_c, values.option_d, values.correct_option);
  logAction(req.session.userId, 'QUESTION_CREATED', `Added a ${values.section} question to vacancy ID ${vacancy.id}.`, req);
  return redirectWith(res, `/admin/vacancies/${vacancy.id}/questions`, 'Question saved.');
};

const deleteQuestion = (req, res) => {
  const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(req.params.id);
  if (!q) return res.status(404).render('404');
  // Do not alter the paper of an exam that has already started.
  const used = db.prepare('SELECT COUNT(*) AS c FROM exam_attempts WHERE vacancy_id = ?').get(q.vacancy_id).c;
  if (used > 0) return redirectWith(res, `/admin/vacancies/${q.vacancy_id}/questions`, 'Questions cannot be deleted after applicants have started the exam.', 'error');
  db.prepare('DELETE FROM questions WHERE id = ?').run(q.id);
  logAction(req.session.userId, 'QUESTION_DELETED', `Deleted question ID ${q.id} from vacancy ID ${q.vacancy_id}.`, req);
  return redirectWith(res, `/admin/vacancies/${q.vacancy_id}/questions`, 'Question deleted.');
};

module.exports = {
  renderExamPage, startExam, submitExam, renderResult,
  renderQuestionBank, questionIndex, createQuestion, deleteQuestion
};
