const express = require('express');
const router = express.Router();
const vacancyController = require('../controllers/vacancyController');
const upload = require('../middlewares/upload');
const { requireAuth, requireAdmin } = require('../middlewares/auth');

// Vacancy routes
router.get('/vacancies', vacancyController.getAllVacancies);
router.get('/vacancies/create', requireAdmin, (req, res) => res.render('create-vacancy'));
router.post('/vacancies/create', requireAdmin, vacancyController.createVacancy);
router.post('/vacancies/:id/apply', requireAuth, upload.fields([{ name: 'cv', maxCount: 1 }, { name: 'supporting_docs', maxCount: 1 }]), vacancyController.applyToVacancy);
router.get('/my-applications', requireAuth, vacancyController.getMyApplications);

// Admin application management routes
router.get('/vacancies/:id/applications', requireAdmin, vacancyController.viewVacancyApplications);
router.post('/applications/:applicationId/status', requireAdmin, vacancyController.updateApplicationStatus);

module.exports = router;
