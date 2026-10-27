// Seeds demo data that matches the current schema (models/db.js).
//   npm run seed
// Creates: 1 admin, 6 applicants, 3 vacancies (open academic, open non-academic with a question
// bank, and a closed non-academic one with shortlisting and exam results already done).
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const db = require('../models/db');
const { uploadDir } = require('../middlewares/upload');
const { academicBreakdown } = require('../utils/qualifications');
const { todayLocalYmd } = require('../utils/time');

const ymd = (offsetDays) => todayLocalYmd(new Date(Date.now() + offsetDays * 86400000));

const run = async () => {
  console.log('Clearing existing data...');
  db.exec(`
    DELETE FROM notifications;
    DELETE FROM exam_attempts;
    DELETE FROM exam_results;
    DELETE FROM questions;
    DELETE FROM applications;
    DELETE FROM vacancies;
    DELETE FROM login_sessions;
    DELETE FROM http_sessions;
    DELETE FROM audit_logs;
    DELETE FROM users;
    DELETE FROM sqlite_sequence WHERE name IN ('users','vacancies','applications','questions','exam_results','exam_attempts','notifications','audit_logs','login_sessions');
  `);

  // Placeholder documents so CV / supporting-document links work for seeded applications.
  for (const f of ['seed-cv.pdf', 'seed-docs.pdf']) {
    const p = path.join(uploadDir, f);
    if (!fs.existsSync(p)) fs.writeFileSync(p, '%PDF-1.4\n% placeholder document for seeded data\n');
  }

  console.log('Inserting demo data...');
  const adminHash = await bcrypt.hash('password123', 10);
  const applicantHash = await bcrypt.hash('pass123', 10);

  const insertUser = db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)');
  insertUser.run('Admin', 'admin@buk.edu.ng', adminHash, 'admin');
  const applicants = [
    ['Alice Smith', 'alice@test.com'], ['Bob Johnson', 'bob@test.com'], ['Charlie Brown', 'charlie@test.com'],
    ['Diana Prince', 'diana@test.com'], ['Evan Wright', 'evan@test.com'], ['Fiona Gallagher', 'fiona@test.com']
  ];
  applicants.forEach(([n, e]) => insertUser.run(n, e, applicantHash, 'applicant'));
  const uid = (email) => db.prepare('SELECT id FROM users WHERE email = ?').get(email).id;

  const insertVacancy = db.prepare(`INSERT INTO vacancies
    (title, department, category, description, requirements, min_qualification, min_experience_years, opens_at, deadline, closed_at, shortlisted_at,
     exam_start, exam_end, aptitude_minutes, literacy_minutes, aptitude_weight, literacy_weight, pass_mark, questions_per_section)
    VALUES (@title, @department, @category, @description, @requirements, @min_qualification, @min_experience_years, @opens_at, @deadline, @closed_at, @shortlisted_at,
            @exam_start, @exam_end, 20, 20, 50, 50, 50, 5)`);
  const base = { closed_at: null, shortlisted_at: null, exam_start: null, exam_end: null };
  const academicId = insertVacancy.run({ ...base, title: 'Lecturer II - Computer Science', department: 'Computer Science', category: 'academic',
    description: 'Teaching and research in Computer Science.', requirements: "Master's degree or higher, 3 years' teaching experience.",
    min_qualification: 'Master', min_experience_years: 3, opens_at: ymd(-5), deadline: ymd(30) }).lastInsertRowid;
  const sysadminId = insertVacancy.run({ ...base, title: 'System Administrator', department: 'IT Directorate', category: 'non-academic',
    description: 'Manage university servers and networks.', requirements: "Bachelor's degree in IT or related field, 1 year experience.",
    min_qualification: 'Bachelor', min_experience_years: 1, opens_at: ymd(-5), deadline: ymd(30) }).lastInsertRowid;
  const closedId = insertVacancy.run({ title: 'Records Officer', department: 'Registry', category: 'non-academic',
    description: 'Maintain staff and student records.', requirements: "Bachelor's degree, 2 years experience.",
    min_qualification: 'Bachelor', min_experience_years: 2, opens_at: ymd(-40), deadline: ymd(-10),
    closed_at: null, shortlisted_at: new Date(Date.now() - 9 * 86400000).toISOString(),
    exam_start: new Date(Date.now() - 5 * 86400000).toISOString(), exam_end: new Date(Date.now() - 4 * 86400000).toISOString() }).lastInsertRowid;

  // Question bank for the open non-academic vacancy and the closed one (10 per section).
  const insertQ = db.prepare(`INSERT INTO questions (vacancy_id, section, question_text, option_a, option_b, option_c, option_d, correct_option)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const aptitude = [
    ['What is 15% of 200?', '20', '30', '35', '40', 'B'], ['Which number completes 2, 4, 8, 16, ...?', '24', '30', '32', '64', 'C'],
    ['If 3 workers finish a job in 12 days, how many days do 6 workers need?', '4', '6', '8', '24', 'B'], ['Choose the word opposite to "scarce".', 'Rare', 'Plentiful', 'Limited', 'Few', 'B'],
    ['A train travels 120 km in 2 hours. Its speed is:', '40 km/h', '50 km/h', '60 km/h', '80 km/h', 'C'], ['Simplify: 3/4 + 1/4', '1', '4/8', '3/16', '1/2', 'A'],
    ['Which is the odd one out?', 'Square', 'Triangle', 'Circle', 'Hammer', 'D'], ['What is the next letter: A, C, E, G, ...?', 'H', 'I', 'J', 'K', 'B'],
    ['20 is what percent of 80?', '20%', '25%', '30%', '40%', 'B'], ['Which word is spelled correctly?', 'Recieve', 'Receive', 'Receeve', 'Reciave', 'B']
  ];
  const literacy = [
    ['What does CPU stand for?', 'Central Processing Unit', 'Computer Personal Unit', 'Central Program Utility', 'Core Processing Union', 'A'],
    ['Which key combination copies selected text on Windows?', 'Ctrl+V', 'Ctrl+X', 'Ctrl+C', 'Ctrl+Z', 'C'], ['Which is an operating system?', 'Excel', 'Linux', 'Chrome', 'Word', 'B'],
    ['What does URL stand for?', 'Uniform Resource Locator', 'Universal Reference Link', 'Unified Resource Library', 'User Request Line', 'A'],
    ['Which program is used to create spreadsheets?', 'Word', 'PowerPoint', 'Excel', 'Outlook', 'C'], ['Which file extension is a PDF?', '.docx', '.pdf', '.xlsx', '.pptx', 'B'],
    ['What is the purpose of a firewall?', 'Speed up the internet', 'Block unauthorised network access', 'Store files', 'Edit images', 'B'], ['1 KB is approximately:', '10 bytes', '100 bytes', '1,000 bytes', '1,000,000 bytes', 'C'],
    ['Which device is an input device?', 'Monitor', 'Printer', 'Keyboard', 'Speaker', 'C'], ['What does "Wi-Fi" provide?', 'Wireless networking', 'Extra storage', 'Power backup', 'Screen display', 'A']
  ];
  for (const v of [sysadminId, closedId]) {
    aptitude.forEach((q) => insertQ.run(v, 'Aptitude', ...q));
    literacy.forEach((q) => insertQ.run(v, 'Computer Literacy', ...q));
  }

  const insertApp = db.prepare(`INSERT INTO applications
    (user_id, vacancy_id, status, status_note, shortlisted, phone, address, highest_qualification, experience_years, qualifications_text, experience_text,
     publications_text, seminars_text, journal_publications_count, seminars_attended, academic_score, exam_completed, exam_score, cv_path, supporting_documents_path)
    VALUES (@user_id, @vacancy_id, @status, @status_note, @shortlisted, '08012345678', 'Kano, Nigeria', @highest_qualification, @experience_years,
            @qualifications_text, @experience_text, @publications_text, @seminars_text, @pubs, @sems, @academic_score, @exam_completed, @exam_score, 'seed-cv.pdf', 'seed-docs.pdf')`);
  const addApp = (email, vacancy_id, o) => {
    const pubs = o.pubs || 0, sems = o.sems || 0;
    const score = o.academic ? academicBreakdown({ highest_qualification: o.highest_qualification, experience_years: o.experience_years, journal_publications_count: pubs, seminars_attended: sems }).total : 0;
    insertApp.run({ user_id: uid(email), vacancy_id, status: 'Pending', status_note: null, shortlisted: 0, exam_completed: 0, exam_score: null,
      qualifications_text: o.highest_qualification, experience_text: '', publications_text: '', seminars_text: '', academic_score: score, pubs, sems, ...o });
  };

  // Open vacancies: pending applications (shortlisting runs automatically after the deadline).
  addApp('alice@test.com', academicId, { highest_qualification: 'PhD', experience_years: 5, pubs: 6, sems: 4, academic: true });
  addApp('bob@test.com', academicId, { highest_qualification: 'Bachelor', experience_years: 1, pubs: 0, sems: 1, academic: true });
  addApp('charlie@test.com', sysadminId, { highest_qualification: 'Bachelor', experience_years: 3 });

  // Closed vacancy: shortlisting and exams already done.
  const examRows = [['diana@test.com', 80, 1], ['evan@test.com', 40, 0]];
  examRows.forEach(([email, pct, passed]) => {
    addApp(email, closedId, { highest_qualification: 'Bachelor', experience_years: 4, status: 'Shortlisted', status_note: 'Meets the minimum requirements for this vacancy.', shortlisted: 1, exam_completed: 1, exam_score: pct });
    db.prepare('INSERT INTO exam_results (user_id, vacancy_id, score, total_questions, percentage, passed, section_scores) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(uid(email), closedId, pct / 10, 10, pct, passed, JSON.stringify([
        { section: 'Aptitude', correct: pct / 20, total: 5, percentage: pct, weight: 50 }, { section: 'Computer Literacy', correct: pct / 20, total: 5, percentage: pct, weight: 50 }]));
  });
  addApp('fiona@test.com', closedId, { highest_qualification: 'Other', experience_years: 0, status: 'Rejected',
    status_note: "Did not meet the requirements: minimum qualification is Bachelor's Degree / HND; minimum experience is 2 year(s).", shortlisted: 0 });

  const log = db.prepare('INSERT INTO audit_logs (user_id, action, description) VALUES (?, ?, ?)');
  log.run(1, 'VACANCY_CREATED', 'Created demo vacancies (seed).');
  log.run(null, 'SHORTLIST_DECISION', `Automatic shortlisting processed vacancy ID ${closedId} ("Records Officer"). Shortlisted 2 out of 3 pending applications.`);

  console.log('Seeding completed successfully.');
  console.log('Admin: admin@buk.edu.ng / password123   Applicants: alice@test.com ... / pass123');
};

run().catch((e) => { console.error('Seeding error:', e); process.exit(1); });
