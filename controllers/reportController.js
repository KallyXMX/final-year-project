const db = require('../models/db');
const { REPORTS, toCsv, toPdf } = require('../services/reports');
const { logAction } = require('../services/audit');

const renderReportsPage = (req, res) => {
  const vacancies = db.prepare('SELECT id, title FROM vacancies ORDER BY title').all();
  res.render('admin/reports', { reports: REPORTS, vacancies });
};

// GET /admin/reports/:type/:format  (?vacancy_id=)
const exportReport = (req, res) => {
  const report = REPORTS[req.params.type];
  const format = req.params.format;
  if (!report || !['pdf', 'csv'].includes(format)) return res.status(404).render('404');

  const vacancyId = req.query.vacancy_id ? parseInt(req.query.vacancy_id, 10) : null;
  let subtitle = 'All vacancies';
  if (vacancyId) {
    const v = db.prepare('SELECT title FROM vacancies WHERE id = ?').get(vacancyId);
    if (!v) return res.status(404).render('404');
    subtitle = `Vacancy: ${v.title}`;
  }
  const rows = report.rows(vacancyId);
  logAction(req.session.userId, 'REPORT_EXPORTED', `Exported "${report.title}" as ${format.toUpperCase()} (${subtitle}, ${rows.length} rows).`, req);

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Disposition', `attachment; filename="${report.file}_${stamp}.${format}"`);
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return res.send(toCsv(report, rows));
  }
  res.setHeader('Content-Type', 'application/pdf');
  return toPdf(res, report, rows, subtitle);
};

module.exports = { renderReportsPage, exportReport };
