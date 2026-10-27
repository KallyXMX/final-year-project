const express = require('express');
const router = express.Router();
const c = require('../controllers/applicationController');
const audit = require('../controllers/auditController');
const { requireAuth, requireAdmin } = require('../middlewares/auth');

router.get('/admin/applications', requireAdmin, c.getAllApplications);
router.get('/admin/applications/:id', requireAdmin, c.renderApplicationDetail);
router.get('/admin/applications/:id/academic-summary', requireAdmin, c.renderApplicationDetail); // legacy URL
router.post('/admin/applications/:id/academic-score', requireAdmin, c.calculateAcademicScore);
router.post('/admin/applications/:id/interview', requireAdmin, c.recordInterviewResult);
router.post('/admin/vacancies/:id/shortlist', requireAdmin, c.runAutoShortlist);
router.get('/admin/vacancies/:id/exam', requireAdmin, c.renderExamSettings);
router.post('/admin/vacancies/:id/exam', requireAdmin, c.saveExamSettings);

// private applicant documents: owner or admin
router.get('/applications/:id/documents/:kind', requireAuth, c.downloadDocument);

router.get('/admin/audit-logs', requireAdmin, audit.getLogs);
router.get('/admin/sessions', requireAdmin, audit.getSessions);

module.exports = router;
