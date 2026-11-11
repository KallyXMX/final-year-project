// Numbers for the HR analytics dashboard (Chart.js, Requirement 6.3).
const db = require('../models/db');
const users = require('./users');
const vacancies = require('./vacancies');
const { vacancyState } = require('../utils/vacancy');
const { STATUS } = require('../utils/constants');

const adminDashboard = () => {
  const count = (sql) => db.prepare(sql).get().c;

  // Applications per status (doughnut chart).
  const statusCounts = Object.fromEntries(Object.values(STATUS).map((s) => [s, 0]));
  db.prepare('SELECT status, COUNT(*) AS count FROM applications GROUP BY status').all()
    .forEach((r) => { if (r.status in statusCounts) statusCounts[r.status] = r.count; });

  // Applications per vacancy, latest 8 (bar chart).
  const perVacancy = db.prepare(`
    SELECT v.title, COUNT(a.id) AS apps FROM vacancies v LEFT JOIN applications a ON a.vacancy_id = v.id
    WHERE v.is_active = 1 GROUP BY v.id ORDER BY v.id DESC LIMIT 8`).all();

  // Exam pass rate (doughnut chart).
  const exam = db.prepare('SELECT SUM(passed) AS passed, COUNT(*) AS total FROM exam_results').get();
  const avg = db.prepare('SELECT AVG(percentage) AS a FROM exam_results').get().a;

  const active = vacancies.listActive().map((v) => ({ ...v, state: vacancyState(v) }));
  return {
    totalUsers: users.countApplicants(),
    totalVacancies: active.filter((v) => v.state === 'Open').length,
    totalApplications: count('SELECT COUNT(*) AS c FROM applications'),
    averageScore: avg ? avg.toFixed(1) : '0',
    statusCounts,
    perVacancy,
    examOutcome: { passed: exam.passed || 0, failed: (exam.total || 0) - (exam.passed || 0) },
    awaitingShortlist: active.filter((v) => v.state === 'Closed' && !v.shortlisted_at).length
  };
};

module.exports = { adminDashboard };
