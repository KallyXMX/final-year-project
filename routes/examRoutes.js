const express = require('express');
const router = express.Router();
const examController = require('../controllers/examController');
const { requireAuth, requireAdmin } = require('../middlewares/auth');

// Exam routes
router.get('/exam/:vacancyId', requireAuth, examController.renderExamPage);
router.get('/questions/create', requireAdmin, (req, res) => res.render('create-question'));
router.post('/questions/create', requireAdmin, examController.createQuestion);

module.exports = router;
