const express = require('express');
const router = express.Router();
const c = require('../controllers/reportController');
const { requireAdmin } = require('../middlewares/auth');

router.get('/admin/reports', requireAdmin, c.renderReportsPage);
// legacy shortcuts
router.get('/admin/reports/pdf', requireAdmin, (req, res) => res.redirect('/admin/reports/merit/pdf'));
router.get('/admin/reports/csv', requireAdmin, (req, res) => res.redirect('/admin/reports/applicants/csv'));
router.get('/admin/reports/:type/:format', requireAdmin, c.exportReport);

module.exports = router;
