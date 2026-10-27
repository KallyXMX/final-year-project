const express = require('express');
const router = express.Router();
const examController = require('../controllers/examController');
const { requireAdmin, requireApplicant } = require('../middlewares/auth');

// Applicant: take the CBT
router.get('/exam/:vacancyId', requireApplicant, examController.renderExamPage);
router.post('/exam/:vacancyId/start', requireApplicant, examController.startExam);
router.post('/exam/:vacancyId/submit', requireApplicant, examController.submitExam);
router.get('/exam/:vacancyId/result', requireApplicant, examController.renderResult);

// HR: question bank
router.get('/questions/create', requireAdmin, examController.questionIndex);
router.get('/admin/vacancies/:id/questions', requireAdmin, examController.renderQuestionBank);
router.post('/questions/create', requireAdmin, examController.createQuestion);
router.post('/questions/:id/delete', requireAdmin, examController.deleteQuestion);

module.exports = router;
