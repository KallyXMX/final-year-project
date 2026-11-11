// Data access for the question bank (Requirement 4.4).
const db = require('../models/db');

const findById = (id) => db.prepare('SELECT * FROM questions WHERE id = ?').get(id);

const listForVacancy = (vacancyId) =>
  db.prepare('SELECT * FROM questions WHERE vacancy_id = ? ORDER BY section, id').all(vacancyId);

// { 'Aptitude': 12, 'Computer Literacy': 9 }
const countsBySection = (vacancyId) => Object.fromEntries(
  db.prepare('SELECT section, COUNT(*) AS c FROM questions WHERE vacancy_id = ? GROUP BY section').all(vacancyId).map((r) => [r.section, r.c]));

const countForVacancy = (vacancyId) =>
  db.prepare('SELECT COUNT(*) AS c FROM questions WHERE vacancy_id = ?').get(vacancyId).c;

const create = (vacancyId, q) => db.prepare(`
  INSERT INTO questions (vacancy_id, section, question_text, option_a, option_b, option_c, option_d, correct_option)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
  .run(vacancyId, q.section, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option);

const remove = (id) => db.prepare('DELETE FROM questions WHERE id = ?').run(id);

// Once anyone has started the exam the paper must not change.
const examStarted = (vacancyId) =>
  db.prepare('SELECT COUNT(*) AS c FROM exam_attempts WHERE vacancy_id = ?').get(vacancyId).c > 0;

module.exports = { findById, listForVacancy, countsBySection, countForVacancy, create, remove, examStarted };
