// Report definitions and PDF/CSV builders (Requirement 4.7). Layer: Application.
const db = require('../models/db');
const PDFDocument = require('pdfkit');
const { createObjectCsvStringifier } = require('csv-writer');
const { vacancyState } = require('../utils/vacancy');
const { capScore, combinedOf } = require('../utils/qualifications');
const { fmtDateTime } = require('../utils/time');

// Requirement 4.7: applicant reports, shortlisted candidate reports, examination results and
// merit lists, recruitment statistics - each as PDF and CSV.

const r1 = (n) => (n === null || n === undefined ? '' : Math.round(n * 10) / 10);

const vacancyFilter = (vacancyId, alias = 'a') => (vacancyId ? { sql: ` AND ${alias}.vacancy_id = ?`, params: [vacancyId] } : { sql: '', params: [] });

const REPORTS = {
  applicants: {
    title: 'Applicants Report',
    file: 'Applicants_Report',
    columns: [
      { key: 'id', header: 'App ID', width: 40 },
      { key: 'name', header: 'Name', width: 110 },
      { key: 'email', header: 'Email', width: 140 },
      { key: 'vacancy', header: 'Vacancy', width: 120 },
      { key: 'category', header: 'Type', width: 65 },
      { key: 'qualification', header: 'Qualification', width: 80 },
      { key: 'experience', header: 'Exp (yrs)', width: 45 },
      { key: 'status', header: 'Status', width: 70 },
      { key: 'applied', header: 'Applied', width: 90 }
    ],
    rows: (vacancyId) => {
      const f = vacancyFilter(vacancyId);
      return db.prepare(`
        SELECT a.id, u.name, u.email, v.title AS vacancy, v.category, a.highest_qualification AS qualification,
               a.experience_years AS experience, a.status, a.applied_at AS applied
        FROM applications a JOIN users u ON u.id = a.user_id JOIN vacancies v ON v.id = a.vacancy_id
        WHERE 1=1 ${f.sql} ORDER BY v.title, a.applied_at DESC`).all(...f.params)
        .map((r) => ({ ...r, applied: fmtDateTime(r.applied) }));
    }
  },

  shortlisted: {
    title: 'Shortlisted Candidates Report',
    file: 'Shortlisted_Candidates',
    columns: [
      { key: 'id', header: 'App ID', width: 40 },
      { key: 'name', header: 'Name', width: 120 },
      { key: 'email', header: 'Email', width: 150 },
      { key: 'vacancy', header: 'Vacancy', width: 130 },
      { key: 'category', header: 'Type', width: 65 },
      { key: 'qualification', header: 'Qualification', width: 85 },
      { key: 'experience', header: 'Exp (yrs)', width: 45 },
      { key: 'status', header: 'Current status', width: 85 }
    ],
    rows: (vacancyId) => {
      const f = vacancyFilter(vacancyId);
      return db.prepare(`
        SELECT a.id, u.name, u.email, v.title AS vacancy, v.category, a.highest_qualification AS qualification,
               a.experience_years AS experience, a.status
        FROM applications a JOIN users u ON u.id = a.user_id JOIN vacancies v ON v.id = a.vacancy_id
        WHERE a.shortlisted = 1 ${f.sql} ORDER BY v.title, u.name`).all(...f.params);
    }
  },

  merit: {
    title: 'Examination Results & Merit List',
    file: 'Merit_List',
    columns: [
      { key: 'rank', header: 'Rank', width: 35 },
      { key: 'name', header: 'Name', width: 120 },
      { key: 'vacancy', header: 'Vacancy', width: 130 },
      { key: 'category', header: 'Type', width: 65 },
      { key: 'academic', header: 'Academic pts', width: 60 },
      { key: 'exam', header: 'Exam %', width: 50 },
      { key: 'result', header: 'Result', width: 55 },
      { key: 'interview', header: 'Interview', width: 55 },
      { key: 'status', header: 'Status', width: 75 },
      // Combined recruitment score (academic vacancies with category maxima only; empty otherwise).
      { key: 'qualification', header: 'Qualification', width: 55 },
      { key: 'experience', header: 'Experience', width: 50 },
      { key: 'publications', header: 'Publications', width: 55 },
      { key: 'personal', header: 'Personal data', width: 50 },
      { key: 'total', header: 'Total /100', width: 45 },
      { key: 'slots', header: 'Slots', width: 55 }
    ],
    // Non-academic candidates are ranked by weighted exam %, academic candidates by their
    // qualification points; interview score (when recorded) breaks ties (Requirement 2.8).
    // Academic vacancies with category maxima are ranked by the combined total (academic part + personal data + interview).
    // When a vacancy has a number of positions (slots), that many top-ranked rows are marked "Within slots" (visual only).
    rows: (vacancyId) => {
      const f = vacancyFilter(vacancyId);
      const raw = db.prepare(`
        SELECT a.id, a.vacancy_id, u.name, v.title AS vacancy, v.category, v.academic_exam_enabled, a.academic_score,
               a.exam_completed, er.percentage, er.passed, a.interview_score, a.personal_data_score, a.status,
               a.highest_qualification, a.experience_years, a.journal_publications_count, a.seminars_attended, v.slots,
               v.pts_phd, v.pts_master, v.pts_bachelor, v.pts_per_year, v.pts_per_publication, v.pts_per_seminar,
               v.max_qualification, v.max_experience, v.max_publications, v.max_personal_data, v.max_interview
        FROM applications a JOIN users u ON u.id = a.user_id JOIN vacancies v ON v.id = a.vacancy_id
        LEFT JOIN exam_results er ON er.user_id = a.user_id AND er.vacancy_id = a.vacancy_id
        WHERE a.shortlisted = 1 ${f.sql}`).all(...f.params);
      // Academic candidates are listed from shortlisting; when HR enabled the exam for the vacancy they are listed once they have sat it.
      const usesExam = (r) => r.category !== 'academic' || Number(r.academic_exam_enabled) === 1;
      const eligible = raw.filter((r) => (r.category === 'academic' ? !usesExam(r) || r.exam_completed : r.exam_completed));
      eligible.forEach((r) => { r.combined = r.category === 'academic' ? combinedOf(r, r) : null; });
      const metric = (r) => (r.combined ? r.combined.total : r.category === 'academic' ? capScore(r.academic_score) : r.percentage || 0);
      eligible.sort((x, y) =>
        x.vacancy_id - y.vacancy_id ||
        metric(y) - metric(x) ||
        (r1(y.percentage) || 0) - (r1(x.percentage) || 0) ||
        (y.interview_score ?? -1) - (x.interview_score ?? -1));
      let lastVacancy = null, rank = 0;
      return eligible.map((r) => {
        if (r.vacancy_id !== lastVacancy) { lastVacancy = r.vacancy_id; rank = 0; }
        rank++;
        return {
          rank,
          name: r.name,
          vacancy: r.vacancy,
          category: r.category,
          academic: r.combined ? r.combined.academic : r.category === 'academic' ? capScore(r.academic_score) : '',
          exam: usesExam(r) ? r1(r.percentage) : '',
          result: usesExam(r) ? (r.passed ? 'Passed' : 'Failed') : '',
          interview: r.interview_score ?? '',
          status: r.status,
          qualification: r.combined ? r.combined.parts.qualification : '',
          experience: r.combined ? r.combined.parts.experience : '',
          publications: r.combined ? r.combined.parts.publications : '',
          personal: r.combined ? (r.combined.personal ?? '') : '',
          total: r.combined ? r.combined.total : '',
          slots: r.slots && rank <= r.slots ? 'Within slots' : ''
        };
      });
    }
  },

  statistics: {
    title: 'Recruitment Statistics',
    file: 'Recruitment_Statistics',
    columns: [
      { key: 'vacancy', header: 'Vacancy', width: 130 },
      { key: 'category', header: 'Type', width: 60 },
      { key: 'state', header: 'State', width: 45 },
      { key: 'applications', header: 'Applied', width: 40 },
      { key: 'shortlisted', header: 'Short-listed', width: 45 },
      { key: 'notShortlisted', header: 'Not short-listed', width: 50 },
      { key: 'examTaken', header: 'Exam taken', width: 45 },
      { key: 'passed', header: 'Passed', width: 40 },
      { key: 'passRate', header: 'Pass rate %', width: 45 },
      { key: 'avgExam', header: 'Avg exam %', width: 45 },
      { key: 'recommended', header: 'Recom-mended', width: 50 },
      { key: 'accepted', header: 'Accepted', width: 45 }
    ],
    rows: (vacancyId) => {
      const vs = vacancyId
        ? db.prepare('SELECT * FROM vacancies WHERE id = ?').all(vacancyId)
        : db.prepare('SELECT * FROM vacancies ORDER BY created_at DESC').all();
      return vs.map((v) => {
        const c = db.prepare(`
          SELECT COUNT(*) AS applications,
                 SUM(CASE WHEN shortlisted = 1 THEN 1 ELSE 0 END) AS shortlisted,
                 SUM(CASE WHEN status = 'Rejected' AND shortlisted = 0 THEN 1 ELSE 0 END) AS notShortlisted,
                 SUM(CASE WHEN status = 'Recommended' THEN 1 ELSE 0 END) AS recommended,
                 SUM(CASE WHEN status = 'Accepted' THEN 1 ELSE 0 END) AS accepted
          FROM applications WHERE vacancy_id = ?`).get(v.id);
        const e = db.prepare('SELECT COUNT(*) AS taken, SUM(passed) AS passed, AVG(percentage) AS avg FROM exam_results WHERE vacancy_id = ?').get(v.id);
        return {
          vacancy: v.title,
          category: v.category,
          state: vacancyState(v),
          applications: c.applications || 0,
          shortlisted: c.shortlisted || 0,
          notShortlisted: c.notShortlisted || 0,
          examTaken: e.taken || 0,
          passed: e.passed || 0,
          passRate: e.taken ? r1((e.passed / e.taken) * 100) : '',
          avgExam: e.avg !== null ? r1(e.avg) : '',
          recommended: c.recommended || 0,
          accepted: c.accepted || 0
        };
      });
    }
  }
};

// Spreadsheet applications treat cells starting with = + - @ as formulas; neutralise them.
const safeCell = (v) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

const toCsv = (report, rows) => {
  const stringifier = createObjectCsvStringifier({
    header: report.columns.map((c) => ({ id: c.key, title: c.header.replace('-', '') }))
  });
  const clean = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, safeCell(v)])));
  return '﻿' + stringifier.getHeaderString() + stringifier.stringifyRecords(clean);
};

// Stream a paginated table to the response as PDF.
const toPdf = (res, report, rows, subtitle) => {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true });
  doc.pipe(res);
  const left = doc.page.margins.left;
  const usable = doc.page.width - left - doc.page.margins.right;
  const total = report.columns.reduce((s, c) => s + c.width, 0);
  const cols = report.columns.map((c) => ({ ...c, w: (c.width / total) * usable }));

  const header = () => {
    doc.font('Helvetica-Bold').fontSize(15).fillColor('#1a202c').text('Bayero University Kano - Staff Recruitment', left, 36, { width: usable });
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#2b6cb0').text(report.title, left, doc.y + 2, { width: usable });
    doc.font('Helvetica').fontSize(9).fillColor('#4a5568')
      .text(`${subtitle || 'All vacancies'}  |  Generated ${fmtDateTime(new Date())}`, left, doc.y + 2, { width: usable });
    doc.moveDown(0.6);
  };

  const tableHead = () => {
    const y = doc.y;
    doc.rect(left, y, usable, 20).fill('#2b6cb0');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
    let x = left;
    for (const c of cols) { doc.text(c.header, x + 3, y + 6, { width: c.w - 6, lineBreak: false, ellipsis: true }); x += c.w; }
    doc.y = y + 22;
    doc.fillColor('#1a202c');
  };

  header();
  tableHead();
  doc.font('Helvetica').fontSize(8);
  const bottomLimit = () => doc.page.height - doc.page.margins.bottom - 20;

  if (rows.length === 0) {
    doc.fillColor('#4a5568').text('No records found.', left, doc.y + 8);
  }
  rows.forEach((row, i) => {
    if (doc.y + 16 > bottomLimit()) {
      doc.addPage();
      header();
      tableHead();
      doc.font('Helvetica').fontSize(8);
    }
    const y = doc.y;
    if (i % 2 === 0) doc.rect(left, y - 2, usable, 16).fill('#f7fafc');
    doc.fillColor('#1a202c');
    let x = left;
    for (const c of cols) {
      const v = row[c.key];
      doc.text(v === null || v === undefined ? '' : String(v), x + 3, y + 1, { width: c.w - 6, lineBreak: false, ellipsis: true });
      x += c.w;
    }
    doc.y = y + 16;
  });

  // footer with page numbers
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const oldBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(8).fillColor('#718096')
      .text(`Page ${i + 1} of ${range.count}`, left, doc.page.height - 28, { width: usable, align: 'center', lineBreak: false });
    doc.page.margins.bottom = oldBottom;
  }
  doc.end();
};

module.exports = { REPORTS, toCsv, toPdf };
