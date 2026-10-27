const express = require('express');
const router = express.Router();
const vacancyController = require('../controllers/vacancyController');
const upload = require('../middlewares/upload');
const { verifyCsrf } = require('../middlewares/csrf');
const { redirectWith } = require('../utils/http');
const { requireAuth, requireAdmin, requireApplicant } = require('../middlewares/auth');

// Public
router.get('/vacancies', vacancyController.getAllVacancies);

// HR
router.get('/vacancies/create', requireAdmin, vacancyController.renderCreateForm);
router.post('/vacancies/create', requireAdmin, vacancyController.createVacancy);
router.post('/admin/vacancies/:id/close', requireAdmin, vacancyController.closeVacancy);
router.post('/admin/vacancies/:id/reopen', requireAdmin, vacancyController.reopenVacancy);
router.get('/vacancies/:id/applications', requireAdmin, vacancyController.viewVacancyApplications);
router.post('/applications/:applicationId/status', requireAdmin, vacancyController.updateApplicationStatus);

// Applicant
router.get('/vacancies/:id/apply', requireApplicant, vacancyController.renderApplyForm);
// multipart: the CSRF token travels in the action URL and is verified after multer parses the form
router.post('/vacancies/:id/apply', requireApplicant, (req, res, next) => {
  upload.fields([{ name: 'cv', maxCount: 1 }, { name: 'supporting_docs', maxCount: 1 }])(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Each file must be 5MB or smaller.' : err.message;
      return redirectWith(res, `/vacancies/${encodeURIComponent(req.params.id)}/apply`, msg, 'error');
    }
    next();
  });
}, verifyCsrf, vacancyController.applyToVacancy);
router.get('/my-applications', requireApplicant, vacancyController.getMyApplications);

// Dashboard (both roles)
router.get('/dashboard', requireAuth, vacancyController.getDashboard);

module.exports = router;
