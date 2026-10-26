const path = require('path');
const bcrypt = require('bcrypt');

const db = require('../models/db');

console.log('Clearing existing test data...');
try {
  db.exec(`
    DELETE FROM audit_logs;
    DELETE FROM exam_results;
    DELETE FROM applications;
    DELETE FROM questions;
    DELETE FROM vacancies;
    DELETE FROM users;
  `);
} catch (e) {
  console.log('Some tables might not exist yet, proceeding...');
}

console.log('Inserting mock data...');

const runSeeder = async () => {
  try {
    const adminHash = await bcrypt.hash('password123', 10);
    const applicantHash = await bcrypt.hash('pass123', 10);

    // 1 Admin User
    const insertUser = db.prepare("INSERT INTO users (id, name, email, password, role) VALUES (?, ?, ?, ?, ?)");
    insertUser.run(1, 'Admin', 'admin@buk.edu.ng', adminHash, 'admin');

    // 10 Mock Applicants
    const applicants = [
      { id: 2, name: 'Alice Smith', email: 'alice@test.com' },
      { id: 3, name: 'Bob Johnson', email: 'bob@test.com' },
      { id: 4, name: 'Charlie Brown', email: 'charlie@test.com' },
      { id: 5, name: 'Diana Prince', email: 'diana@test.com' },
      { id: 6, name: 'Evan Wright', email: 'evan@test.com' },
      { id: 7, name: 'Fiona Gallagher', email: 'fiona@test.com' },
      { id: 8, name: 'George Miller', email: 'george@test.com' },
      { id: 9, name: 'Hannah Abbott', email: 'hannah@test.com' },
      { id: 10, name: 'Ian Malcolm', email: 'ian@test.com' },
      { id: 11, name: 'Julia Roberts', email: 'julia@test.com' }
    ];

    for (const applicant of applicants) {
      insertUser.run(applicant.id, applicant.name, applicant.email, applicantHash, 'applicant');
    }

    // 2 Vacancies
    const insertVacancy = db.prepare("INSERT INTO vacancies (id, title, department, description, requirements) VALUES (?, ?, ?, ?, ?)");
    insertVacancy.run(1, 'Lecturer II - Computer Science', 'Computer Science', 'Teaching and research in CS.', 'Requires Master Degree. 3 years teaching experience.');
    insertVacancy.run(2, 'System Administrator', 'IT Directorate', 'Manage university servers and networks.', 'Requires Bachelor Degree in IT or related field.');

    // 5 Mock Applications
    const insertApp = db.prepare(`
      INSERT INTO applications 
      (id, user_id, vacancy_id, status, highest_qualification, teaching_experience_years, exam_completed, exam_score) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    // Academic applications for Vacancy 1
    insertApp.run(1, 2, 1, 'Shortlisted', 'Master of Science', 4, 0, null);
    insertApp.run(2, 3, 1, 'Pending', 'PhD', 5, 0, null);
    insertApp.run(3, 4, 1, 'Rejected', 'Bachelor of Science', 1, 0, null);
    
    // Non-Academic applications for Vacancy 2
    insertApp.run(4, 5, 2, 'Pending', 'Bachelor of Technology', 0, 1, 80);
    insertApp.run(5, 6, 2, 'Pending', 'Bachelor of Science', 0, 1, 65);
    // Add one more just so we have 3 exam results matching the non-academic applicants
    insertApp.run(6, 7, 2, 'Pending', 'Master of IT', 0, 1, 40);

    // 3 Mock Exam Results for non-academic applicants
    const insertExam = db.prepare("INSERT INTO exam_results (user_id, vacancy_id, score, total_questions, percentage, passed) VALUES (?, ?, ?, ?, ?, ?)");
    insertExam.run(5, 2, 8, 10, 80, 1);
    insertExam.run(6, 2, 6, 10, 60, 1);
    insertExam.run(7, 2, 4, 10, 40, 0);

    // 5 Mock Audit Logs
    const insertLog = db.prepare("INSERT INTO audit_logs (user_id, action, description) VALUES (?, ?, ?)");
    insertLog.run(1, 'LOGIN', 'User admin@buk.edu.ng logged in successfully as admin.');
    insertLog.run(1, 'VACANCY_CREATED', 'Created new vacancy: Lecturer II - Computer Science.');
    insertLog.run(2, 'APPLICATION_SUBMITTED', 'User alice@test.com submitted application for Lecturer II.');
    insertLog.run(5, 'SCORE_CHANGE', 'CBT Exam score calculated and saved. Score: 80.00% for Vacancy ID: 2');
    insertLog.run(1, 'SHORTLIST_DECISION', 'Auto-shortlisting engine processed vacancy ID 1. Shortlisted 1 out of 3 applications.');

    console.log('Seeding completed successfully!');
  } catch (error) {
    console.error('Seeding error:', error);
  }
};

runSeeder();
