const db = require('../models/db');
const PDFDocument = require('pdfkit');
const { createObjectCsvStringifier } = require('csv-writer');

const exportMeritListPDF = (req, res) => {
  try {
    if (!req.session || req.session.role !== 'admin') {
      return res.status(403).send('Access denied: Admins only.');
    }

    const passedApplicants = db.prepare(`
      SELECT u.name, v.title AS vacancy_title, a.status, er.score, er.percentage
      FROM exam_results er
      JOIN users u ON er.user_id = u.id
      JOIN vacancies v ON er.vacancy_id = v.id
      JOIN applications a ON a.user_id = er.user_id AND a.vacancy_id = er.vacancy_id
      WHERE er.passed = 1
      ORDER BY er.percentage DESC
    `).all();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="BUK_Merit_List.pdf"');

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);

    // BUK Header
    doc.fontSize(20).text('Bayero University Kano', { align: 'center' });
    doc.fontSize(14).text('Recruitment Merit List', { align: 'center' });
    doc.moveDown(2);

    if (passedApplicants.length === 0) {
      doc.fontSize(12).text('No applicants have passed the CBT yet.', { align: 'center' });
    } else {
      passedApplicants.forEach((app, index) => {
        doc.fontSize(12).text(`${index + 1}. ${app.name}`, { continued: true });
        doc.text(` | Vacancy: ${app.vacancy_title} | Score: ${app.percentage}% | Status: ${app.status}`, { align: 'right' });
        doc.moveDown(0.5);
        doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke('#cccccc');
        doc.moveDown(0.5);
      });
    }

    doc.end();
  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(500).send('Internal server error while generating PDF.');
  }
};

const exportApplicantsCSV = (req, res) => {
  try {
    if (!req.session || req.session.role !== 'admin') {
      return res.status(403).send('Access denied: Admins only.');
    }

    const applicants = db.prepare(`
      SELECT a.id, u.name, v.title AS vacancy_title, a.status, a.exam_score
      FROM applications a
      JOIN users u ON a.user_id = u.id
      JOIN vacancies v ON a.vacancy_id = v.id
      ORDER BY a.applied_at DESC
    `).all();

    const csvStringifier = createObjectCsvStringifier({
      header: [
        { id: 'id', title: 'Applicant ID' },
        { id: 'name', title: 'Name' },
        { id: 'vacancy', title: 'Vacancy' },
        { id: 'status', title: 'Status' },
        { id: 'score', title: 'Exam Score' }
      ]
    });

    const records = applicants.map(app => ({
      id: app.id,
      name: app.name,
      vacancy: app.vacancy_title,
      status: app.status,
      score: app.exam_score !== null ? `${app.exam_score}%` : 'N/A'
    }));

    const csvData = csvStringifier.getHeaderString() + csvStringifier.stringifyRecords(records);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="Applicants_Report.csv"');
    res.send(csvData);
  } catch (error) {
    console.error('Error generating CSV:', error);
    res.status(500).send('Internal server error while generating CSV.');
  }
};

module.exports = {
  exportMeritListPDF,
  exportApplicantsCSV
};
