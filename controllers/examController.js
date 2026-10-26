const db = require('../models/db');

// Render the exam page for a specific vacancy
const renderExamPage = (req, res) => {
  try {
    const vacancyId = req.params.vacancyId;

    // Check if user is authenticated
    if (!req.session || !req.session.userId) {
      return res.redirect('/login');
    }

    const application = db.prepare('SELECT exam_completed FROM applications WHERE user_id = ? AND vacancy_id = ?').get(req.session.userId, vacancyId);
    if (!application) {
      return res.redirect('/dashboard?error=not_applied');
    }
    if (application.exam_completed) {
      return res.redirect('/dashboard?error=Exam%20already%20completed');
    }

    const vacancy = db.prepare('SELECT * FROM vacancies WHERE id = ?').get(vacancyId);
    if (!vacancy) {
      return res.status(404).send('Vacancy not found.');
    }

    const questions = db.prepare('SELECT id, vacancy_id, question_text, option_a, option_b, option_c, option_d FROM questions WHERE vacancy_id = ? ORDER BY RANDOM() LIMIT 20').all(vacancyId);

    return res.render('exam', {
      questions,
      vacancyId,
      vacancy,
      user: req.session
    });
  } catch (error) {
    console.error('Error rendering exam page:', error);
    return res.status(500).render('500');
  }
};

// Handle exam submission, score calculation, and result recording
const submitExam = (req, res) => {
  try {
    const userId = req.session ? req.session.userId : null;
    const { vacancy_id, ...submittedAnswers } = req.body;

    if (!userId) {
      return res.redirect('/login');
    }

    const questions = db.prepare('SELECT id, correct_option FROM questions WHERE vacancy_id = ?').all(vacancy_id);
    const total_questions = questions.length;
    
    if (total_questions === 0) {
      return res.status(400).send('No questions found for this vacancy.');
    }

    let correct_answers = 0;

    questions.forEach((q) => {
      let userAnswer = submittedAnswers[q.id] || submittedAnswers[`q_${q.id}`] || submittedAnswers[`question_${q.id}`];

      if (userAnswer && userAnswer.toString().trim().toUpperCase() === q.correct_option.toString().trim().toUpperCase()) {
        correct_answers += 1;
      }
    });

    const percentage = (correct_answers / total_questions) * 100;
    const passed = percentage >= 50 ? 1 : 0;

    // Insert result into exam_results table
    const stmt = db.prepare(`
      INSERT INTO exam_results (user_id, vacancy_id, score, total_questions, percentage, passed)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(userId, vacancy_id, correct_answers, total_questions, percentage, passed);

    // Update applications table
    const appUpdateStmt = db.prepare(`
      UPDATE applications 
      SET exam_completed = 1, exam_score = ? 
      WHERE user_id = ? AND vacancy_id = ?
    `);
    appUpdateStmt.run(percentage, userId, vacancy_id);

    const vacancy = db.prepare('SELECT * FROM vacancies WHERE id = ?').get(vacancy_id);
    const applicant = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

    const auditController = require('./auditController');
    auditController.logAction(userId, 'SCORE_CHANGE', `CBT Exam score calculated and saved. Score: ${percentage.toFixed(2)}% for Vacancy ID: ${vacancy_id}`);

    return res.render('exam_result', {
      score: correct_answers,
      totalQuestions: total_questions,
      percentage: percentage.toFixed(2),
      passed: passed === 1,
      vacancy,
      applicant
    });
  } catch (error) {
    console.error('Error submitting exam:', error);
    return res.status(500).render('500');
  }
};

// Add a new question for a vacancy (admin only)
const createQuestion = (req, res) => {
  try {
    if (!req.session || req.session.role !== 'admin') {
      return res.status(403).send('Access denied: Admins only.');
    }

    const { vacancy_id, question_text, option_a, option_b, option_c, option_d, correct_option } = req.body;

    if (!vacancy_id || !question_text || !option_a || !option_b || !option_c || !option_d || !correct_option) {
      return res.status(400).send('All question fields and options are required.');
    }

    const stmt = db.prepare(`
      INSERT INTO questions (vacancy_id, question_text, option_a, option_b, option_c, option_d, correct_option)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      vacancy_id,
      question_text,
      option_a,
      option_b,
      option_c,
      option_d,
      correct_option.toString().trim().toUpperCase()
    );

    return res.redirect(`/exam/${vacancy_id}`);
  } catch (error) {
    console.error('Error creating question:', error);
    return res.status(500).render('500');
  }
};

module.exports = {
  renderExamPage,
  submitExam,
  createQuestion
};
