// HR applicant management (Requirements 4.1, 4.3, 4.5, 4.6): search/filter, qualification summary for the
// panel, academic re-scoring, interview results, shortlisting trigger, exam scheduling, document download.
// Controllers only read the request, call a service and render/redirect. Layer: Application.
const fs = require('fs');
const path = require('path');
const vacanciesSvc = require('../services/vacancies');
const applicationsSvc = require('../services/applications');
const questionsSvc = require('../services/questions');
const { logAction } = require('../services/audit');
const { notify } = require('../services/notifications');
const { shortlistVacancy } = require('../services/shortlisting');
const { vacancyState } = require('../utils/vacancy');
const { academicBreakdown, schemeOf, splitLines } = require('../utils/qualifications');
const examSvc = require('../services/exam');
const { hasExam } = require('../utils/vacancy');
const { localInputToIso, isoToLocalInput, fmtDateTime } = require('../utils/time');
const { redirectWith, toInt } = require('../utils/http');
const { STATUS, QUALIFICATIONS } = require('../utils/constants');
const { uploadDir } = require('../middlewares/upload');

// ------------------------------------------------------------ all applicants (search / filter)

const getAllApplications = (req, res) => {
  res.render('admin/all-applicants', {
    applications: applicationsSvc.search(req.query),
    vacancies: vacanciesSvc.listTitles(),
    query: req.query
  });
};

// ------------------------------------------------------------ applicant detail / panel summary (4.5)

const renderApplicationDetail = (req, res) => {
  const application = applicationsSvc.findDetail(req.params.id);
  if (!application) return res.status(404).render('404');

  const scheme = schemeOf(application);
  const breakdown = academicBreakdown(application, scheme);
  const exam = applicationsSvc.findExamResult(application.user_id, application.vacancy_id);
  const sectionScores = exam && exam.section_scores ? JSON.parse(exam.section_scores) : [];
  res.render('admin/applicant-detail', {
    application, breakdown, scheme, exam, sectionScores, usesExam: hasExam(application),
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
  const app = applicationsSvc.findById(req.params.id);
  if (!app) return res.status(404).render('404');
  const hq = QUALIFICATIONS.includes(req.body.highest_qualification) ? req.body.highest_qualification : app.highest_qualification;
  const data = {
    highest_qualification: hq,
    experience_years: Math.min(60, Math.max(0, toInt(req.body.experience_years, app.experience_years))),
    journal_publications_count: Math.min(500, Math.max(0, toInt(req.body.journal_publications_count, app.journal_publications_count))),
    seminars_attended: Math.min(500, Math.max(0, toInt(req.body.seminars_attended, app.seminars_attended)))
  };
  const vacancy = vacanciesSvc.findById(app.vacancy_id);
  const total = academicBreakdown(data, schemeOf(vacancy)).total;
  applicationsSvc.updateAcademicFigures(app.id, data, total);
  logAction(req.session.userId, 'SCORE_CHANGE', `HR re-evaluated academic score for application ID ${app.id}: ${app.academic_score} -> ${total} points.`, req);
  return redirectWith(res, `/admin/applications/${app.id}`, `Academic score updated: ${total} points.`);
};

// ------------------------------------------------------------ interview support (4.6, optional)

const recordInterviewResult = (req, res) => {
  const app = applicationsSvc.findWithVacancyTitle(req.params.id);
  if (!app) return res.status(404).render('404');
  const back = `/admin/applications/${app.id}`;
  if (!app.shortlisted || ![STATUS.SHORTLISTED, STATUS.RECOMMENDED].includes(app.status)) {
    return redirectWith(res, back, 'Interview results can only be recorded for shortlisted candidates.', 'error');
  }
  const score = Number(req.body.interview_score);
  if (!Number.isFinite(score) || score < 0 || score > 100) return redirectWith(res, back, 'Interview score must be between 0 and 100.', 'error');
  const remarks = String(req.body.interviewer_remarks || '').trim().slice(0, 2000);
  const decision = req.body.final_decision;
  const status = decision === STATUS.RECOMMENDED || decision === STATUS.REJECTED ? decision : app.status;

  applicationsSvc.saveInterview(app.id, Math.round(score), remarks, status);
  logAction(req.session.userId, 'INTERVIEW_RECORDED', `Interview score ${Math.round(score)} recorded for application ID ${app.id}; status ${app.status} -> ${status}.`, req);
  if (status !== app.status) {
    notify(app.user_id, status === STATUS.RECOMMENDED
      ? `You have been recommended for "${app.title}" following the interview.`
      : `Your application for "${app.title}" was unsuccessful after the interview stage.`, '/my-applications');
  }
  return redirectWith(res, back, 'Interview evaluation saved.');
};

// ------------------------------------------------------------ shortlisting (4.3)

const runAutoShortlist = (req, res) => {
  const vacancy = vacanciesSvc.findById(req.params.id);
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
  const vacancy = vacanciesSvc.findById(req.params.id);
  if (!vacancy) return res.status(404).render('404');
  res.render('admin/exam-settings', {
    vacancy, error: null,
    values: { ...vacancy, exam_start: isoToLocalInput(vacancy.exam_start), exam_end: isoToLocalInput(vacancy.exam_end) },
    counts: questionsSvc.countsBySection(vacancy.id),
    sections: examSvc.sectionConfig(vacancy).map((s) => s.name)
  });
};

const saveExamSettings = (req, res) => {
  const vacancy = vacanciesSvc.findById(req.params.id);
  if (!vacancy) return res.status(404).render('404');
  if (!hasExam(vacancy)) return redirectWith(res, `/vacancies/${vacancy.id}/applications`, 'The online test is not enabled for this vacancy. Switch it on in the vacancy settings first.', 'error');
  const b = req.body;
  const v = {
    exam_start: String(b.exam_start || ''), exam_end: String(b.exam_end || ''),
    aptitude_minutes: toInt(b.aptitude_minutes, vacancy.aptitude_minutes ?? 20), literacy_minutes: toInt(b.literacy_minutes, vacancy.literacy_minutes ?? 20),
    aptitude_weight: toInt(b.aptitude_weight, vacancy.aptitude_weight ?? 50), literacy_weight: toInt(b.literacy_weight, vacancy.literacy_weight ?? 50),
    pass_mark: toInt(b.pass_mark, 50), questions_per_section: toInt(b.questions_per_section, 10)
  };
  const counts = questionsSvc.countsBySection(vacancy.id);
  const sections = examSvc.sectionConfig(vacancy).map((s) => s.name);
  const fail = (msg) => res.status(400).render('admin/exam-settings', { vacancy, error: msg, values: v, counts, sections });

  const startIso = localInputToIso(v.exam_start);
  const endIso = localInputToIso(v.exam_end);
  if (!startIso || !endIso) return fail('Please set the exam start and end date/time.');
  if (new Date(endIso) <= new Date(startIso)) return fail('The exam end must be after the start.');
  if (new Date(endIso) < new Date()) return fail('The exam window must end in the future.');
  if (v.aptitude_minutes < 1 || v.aptitude_minutes > 180 || v.literacy_minutes < 1 || v.literacy_minutes > 180) return fail('Section durations must be between 1 and 180 minutes.');
  // Weights only matter when both sections are on; a single section always counts at full weight.
  if (sections.length > 1 && (v.aptitude_weight < 0 || v.literacy_weight < 0 || v.aptitude_weight + v.literacy_weight <= 0)) return fail('Section weights must be non-negative and not both zero.');
  if (v.pass_mark < 0 || v.pass_mark > 100) return fail('Pass mark must be between 0 and 100.');
  if (v.questions_per_section < 1 || v.questions_per_section > 100) return fail('Questions per section must be between 1 and 100.');
  if (!sections.some((n) => counts[n])) return fail(`Add questions to the question bank (${sections.join(' / ')}) before scheduling the exam.`);

  vacanciesSvc.saveExamSettings(vacancy.id, { ...v, exam_start: startIso, exam_end: endIso });
  logAction(req.session.userId, 'EXAM_SCHEDULED', `Exam scheduled for vacancy ID ${vacancy.id}: ${fmtDateTime(startIso)} to ${fmtDateTime(endIso)}, pass mark ${v.pass_mark}%, sections: ${sections.join(' + ')}, minutes ${v.aptitude_minutes}/${v.literacy_minutes}, weights ${v.aptitude_weight}/${v.literacy_weight}, ${v.questions_per_section} questions per section.`, req);

  // Tell shortlisted applicants who have not yet taken the exam.
  const targets = applicationsSvc.awaitingExam(vacancy.id);
  targets.forEach((t) => notify(t.user_id,
    `Your ${sections.join(' and ').toLowerCase()} test${sections.length > 1 ? 's' : ''} for "${vacancy.title}" are scheduled: opens ${fmtDateTime(startIso)}, closes ${fmtDateTime(endIso)}.`, '/my-applications'));
  return redirectWith(res, `/vacancies/${vacancy.id}/applications`, `Exam scheduled. ${targets.length} shortlisted applicant(s) notified.`);
};

// ------------------------------------------------------------ applicant documents (4.2, 4.8)

// Documents are private: only the owning applicant or an admin may download them.
const downloadDocument = (req, res) => {
  const app = applicationsSvc.findById(req.params.id);
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
  runAutoShortlist, renderExamSettings, saveExamSettings, downloadDocument
};
