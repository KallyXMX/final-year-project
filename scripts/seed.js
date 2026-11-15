// Seeds demo data that matches the current schema (models/db.js) and shows every current feature.
//   npm run seed
// WARNING: this clears the existing data first (users, vacancies, applications, questions, exam results, notifications, logs).
//
// Creates (see the summary printed at the end):
//   - 1 admin and 12 applicants
//   - "Lecturer II"                  academic, maxima 30/20/20/10/20, 2 positions, default points, exam off, closed + shortlisted,
//                                     6 shortlisted applicants (4 with personal data + interview scores, 2 without)
//   - "Senior Lecturer - Physics"    academic, different points (30/20/10/4/3/1) and maxima (35/20/25/10/10), 1 position, open, 3 pending applicants
//   - "Records Officer"              non-academic, exam ON, Aptitude section OFF, 15 Computer Literacy questions, 4 applicants, 2 exam results
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const db = require('../models/db');
const { uploadDir } = require('../middlewares/upload');
const { academicBreakdown, schemeOf } = require('../utils/qualifications');
const { todayLocalYmd, fmtDateTime } = require('../utils/time');

const ymd = (offsetDays) => todayLocalYmd(new Date(Date.now() + offsetDays * 86400000));
const isoAgo = (days) => new Date(Date.now() - days * 86400000).toISOString();
const dbTime = (daysAgo) => isoAgo(daysAgo).replace('T', ' ').slice(0, 19); // "YYYY-MM-DD HH:MM:SS" like CURRENT_TIMESTAMP

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

  // ---------------------------------------------------------------- users
  const insertUser = db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)');
  insertUser.run('Admin', 'admin@buk.edu.ng', adminHash, 'admin');
  const applicants = [
    ['Alice Smith', 'alice@test.com'], ['Bob Johnson', 'bob@test.com'], ['Charlie Brown', 'charlie@test.com'],
    ['Diana Prince', 'diana@test.com'], ['Evan Wright', 'evan@test.com'], ['Fiona Gallagher', 'fiona@test.com'],
    ['Grace Okafor', 'grace@test.com'], ['Hassan Bello', 'hassan@test.com'],
    ['Ibrahim Musa', 'ibrahim@test.com'], ['Jamila Yusuf', 'jamila@test.com'], ['Kabiru Sani', 'kabiru@test.com'], ['Lami Adamu', 'lami@test.com']
  ];
  applicants.forEach(([n, e]) => insertUser.run(n, e, applicantHash, 'applicant'));
  const uid = (email) => db.prepare('SELECT id FROM users WHERE email = ?').get(email).id;
  const adminId = uid('admin@buk.edu.ng');

  // ---------------------------------------------------------------- vacancies
  const insertVacancy = db.prepare(`INSERT INTO vacancies
    (title, department, category, description, requirements, min_qualification, min_experience_years, opens_at, deadline, closed_at, shortlisted_at,
     exam_start, exam_end, aptitude_minutes, literacy_minutes, aptitude_weight, literacy_weight, pass_mark, questions_per_section,
     pts_phd, pts_master, pts_bachelor, pts_per_year, pts_per_publication, pts_per_seminar,
     max_qualification, max_experience, max_publications, max_personal_data, max_interview, slots,
     academic_exam_enabled, aptitude_enabled, literacy_enabled)
    VALUES (@title, @department, @category, @description, @requirements, @min_qualification, @min_experience_years, @opens_at, @deadline, @closed_at, @shortlisted_at,
            @exam_start, @exam_end, @aptitude_minutes, @literacy_minutes, @aptitude_weight, @literacy_weight, @pass_mark, @questions_per_section,
            @pts_phd, @pts_master, @pts_bachelor, @pts_per_year, @pts_per_publication, @pts_per_seminar,
            @max_qualification, @max_experience, @max_publications, @max_personal_data, @max_interview, @slots,
            @academic_exam_enabled, @aptitude_enabled, @literacy_enabled)`);
  const vacancyDefaults = {
    closed_at: null, shortlisted_at: null, exam_start: null, exam_end: null,
    aptitude_minutes: 20, literacy_minutes: 20, aptitude_weight: 50, literacy_weight: 50, pass_mark: 50, questions_per_section: 10,
    pts_phd: 40, pts_master: 25, pts_bachelor: 10, pts_per_year: 5, pts_per_publication: 4, pts_per_seminar: 2,
    max_qualification: null, max_experience: null, max_publications: null, max_personal_data: null, max_interview: null, slots: null,
    academic_exam_enabled: 0, aptitude_enabled: 1, literacy_enabled: 1
  };
  const addVacancy = (o) => {
    const id = insertVacancy.run({ ...vacancyDefaults, ...o }).lastInsertRowid;
    return db.prepare('SELECT * FROM vacancies WHERE id = ?').get(id);
  };

  // 1. Academic, category maxima 30/20/20/10/20, 2 positions, default points, exam off. Closed and already shortlisted.
  const lecturer = addVacancy({
    title: 'Lecturer II', department: 'Computer Science', category: 'academic',
    description: 'Teaching and research in Computer Science.', requirements: "Master's degree or higher, 3 years' teaching experience.",
    min_qualification: 'Master', min_experience_years: 3, opens_at: ymd(-45), deadline: ymd(-15), shortlisted_at: isoAgo(14),
    max_qualification: 30, max_experience: 20, max_publications: 20, max_personal_data: 10, max_interview: 20, slots: 2
  });
  // 2. Academic with a different points scheme (PhD 30, Master 20, Bachelor 10, 4 per year, 3 per publication, 1 per seminar)
  //    and different maxima (35/20/25/10/10), 1 position. Still open for applications.
  const physics = addVacancy({
    title: 'Senior Lecturer - Physics', department: 'Physics', category: 'academic',
    description: 'Teaching and research in Physics.', requirements: "Master's degree or higher, 2 years' teaching experience.",
    min_qualification: 'Master', min_experience_years: 2, opens_at: ymd(-5), deadline: ymd(20),
    pts_phd: 30, pts_master: 20, pts_bachelor: 10, pts_per_year: 4, pts_per_publication: 3, pts_per_seminar: 1,
    max_qualification: 35, max_experience: 20, max_publications: 25, max_personal_data: 10, max_interview: 10, slots: 1
  });
  // 3. Non-academic with the online exam: Aptitude section OFF, Computer Literacy only (full weight). The exam window is open now.
  const records = addVacancy({
    title: 'Records Officer', department: 'Registry', category: 'non-academic',
    description: 'Maintain staff and student records.', requirements: "Bachelor's degree, 2 years experience.",
    min_qualification: 'Bachelor', min_experience_years: 2, opens_at: ymd(-30), deadline: ymd(-5), shortlisted_at: isoAgo(4),
    exam_start: isoAgo(2), exam_end: new Date(Date.now() + 7 * 86400000).toISOString(),
    literacy_minutes: 20, pass_mark: 50, questions_per_section: 10, aptitude_enabled: 0, literacy_enabled: 1
  });

  // ---------------------------------------------------------------- question bank: 15 Computer Literacy questions for Records Officer
  const insertQ = db.prepare(`INSERT INTO questions (vacancy_id, section, question_text, option_a, option_b, option_c, option_d, correct_option)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const literacy = [
    ['What does CPU stand for?', 'Central Processing Unit', 'Computer Personal Unit', 'Central Program Utility', 'Core Processing Union', 'A'],
    ['Which key combination copies selected text on Windows?', 'Ctrl+V', 'Ctrl+X', 'Ctrl+C', 'Ctrl+Z', 'C'],
    ['Which is an operating system?', 'Excel', 'Linux', 'Chrome', 'Word', 'B'],
    ['What does URL stand for?', 'Uniform Resource Locator', 'Universal Reference Link', 'Unified Resource Library', 'User Request Line', 'A'],
    ['Which program is used to create spreadsheets?', 'Word', 'PowerPoint', 'Excel', 'Outlook', 'C'],
    ['Which file extension is a PDF?', '.docx', '.pdf', '.xlsx', '.pptx', 'B'],
    ['What is the purpose of a firewall?', 'Speed up the internet', 'Block unauthorised network access', 'Store files', 'Edit images', 'B'],
    ['1 KB is approximately:', '10 bytes', '100 bytes', '1,000 bytes', '1,000,000 bytes', 'C'],
    ['Which device is an input device?', 'Monitor', 'Printer', 'Keyboard', 'Speaker', 'C'],
    ['What does "Wi-Fi" provide?', 'Wireless networking', 'Extra storage', 'Power backup', 'Screen display', 'A'],
    ['Which of these is a web browser?', 'Windows', 'Firefox', 'Excel', 'Linux', 'B'],
    ['What does "RAM" stand for?', 'Random Access Memory', 'Read Access Module', 'Rapid Application Memory', 'Real Active Memory', 'A'],
    ['Which symbol starts a formula in Excel?', '#', '$', '=', '&', 'C'],
    ['Which of these is the strongest password?', 'Your name', '12345678', 'A long mix of letters, numbers and symbols', 'password', 'C'],
    ['Which file extension is a Word document?', '.pdf', '.xlsx', '.docx', '.jpg', 'C']
  ];
  literacy.forEach((q) => insertQ.run(records.id, 'Computer Literacy', ...q));

  // ---------------------------------------------------------------- applications
  const insertApp = db.prepare(`INSERT INTO applications
    (user_id, vacancy_id, status, status_note, shortlisted, phone, address, highest_qualification, experience_years, qualifications_text, experience_text,
     publications_text, seminars_text, journal_publications_count, seminars_attended, academic_score, personal_data_score, interview_score, interviewer_remarks,
     exam_completed, exam_score, cv_path, supporting_documents_path, applied_at)
    VALUES (@user_id, @vacancy_id, @status, @status_note, @shortlisted, '08012345678', 'Kano, Nigeria', @highest_qualification, @experience_years,
            @qualifications_text, @experience_text, @publications_text, @seminars_text, @pubs, @sems, @academic_score, @personal_data_score, @interview_score,
            @interviewer_remarks, @exam_completed, @exam_score, 'seed-cv.pdf', 'seed-docs.pdf', @applied_at)`);
  const insertExam = db.prepare('INSERT INTO exam_results (user_id, vacancy_id, score, total_questions, percentage, passed, section_scores) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const MET = 'Meets the minimum requirements for this vacancy.';

  // o: qualification, years, pubs, sems, status, note, shortlisted (true/false), personal, interview, remarks, exam {correct, total}, daysAgo
  const addApp = (email, vacancy, o) => {
    const pubs = o.pubs || 0, sems = o.sems || 0, years = o.years || 0;
    const academic = vacancy.category === 'academic';
    // Academic score under THIS vacancy's own points scheme and category maxima.
    const score = academic
      ? academicBreakdown({ highest_qualification: o.qualification, experience_years: years, journal_publications_count: pubs, seminars_attended: sems }, schemeOf(vacancy)).total
      : 0;
    const pct = o.exam ? Math.round((o.exam.correct / o.exam.total) * 10000) / 100 : null;
    insertApp.run({
      user_id: uid(email), vacancy_id: vacancy.id, status: o.status || 'Pending', status_note: o.note || null, shortlisted: o.shortlisted ? 1 : 0,
      highest_qualification: o.qualification, experience_years: years, qualifications_text: o.qualification,
      experience_text: years ? `${years} year(s) relevant experience` : '',
      publications_text: academic ? Array.from({ length: pubs }, (_, i) => `Journal article ${i + 1}`).join('\n') : '',
      seminars_text: academic ? Array.from({ length: sems }, (_, i) => `Seminar / workshop ${i + 1}`).join('\n') : '',
      pubs: academic ? pubs : 0, sems: academic ? sems : 0, academic_score: score,
      personal_data_score: o.personal ?? null, interview_score: o.interview ?? null, interviewer_remarks: o.remarks || null,
      exam_completed: o.exam ? 1 : 0, exam_score: pct, applied_at: dbTime(o.daysAgo ?? 20)
    });
    if (o.exam) {
      insertExam.run(uid(email), vacancy.id, o.exam.correct, o.exam.total, pct, pct >= vacancy.pass_mark ? 1 : 0,
        JSON.stringify([{ section: 'Computer Literacy', correct: o.exam.correct, total: o.exam.total, percentage: pct, weight: 100 }]));
    }
  };

  // Lecturer II: 6 shortlisted applicants. Four have personal data + interview scores (Bob 85 and Charlie 84.5 are close, and the
  // 2-position cut falls between them); Evan and Fiona have no scores yet, so they show "(incomplete)" and "Not ranked yet"
  // even though Fiona's academic part (61) is higher than Diana's total (60).
  addApp('alice@test.com', lecturer, { qualification: 'PhD', years: 8, pubs: 6, sems: 5, status: 'Recommended', note: 'Recommended by the panel after the interview.', shortlisted: true,
    personal: 9, interview: 17, remarks: 'Excellent research record and teaching demonstration.', daysAgo: 44 });
  addApp('bob@test.com', lecturer, { qualification: 'PhD', years: 4, pubs: 2, sems: 1, status: 'Recommended', note: 'Recommended by the panel after the interview.', shortlisted: true,
    personal: 8.5, interview: 16.5, remarks: 'Strong candidate; fewer publications.', daysAgo: 43 });
  addApp('charlie@test.com', lecturer, { qualification: 'Master', years: 5, pubs: 4, sems: 3, status: 'Recommended', note: 'Recommended by the panel after the interview.', shortlisted: true,
    personal: 7, interview: 12.5, remarks: 'Good publications; interview was average.', daysAgo: 42 });
  addApp('diana@test.com', lecturer, { qualification: 'Master', years: 3, pubs: 1, sems: 0, status: 'Shortlisted', note: MET, shortlisted: true,
    personal: 6, interview: 10, remarks: 'Meets the requirements; limited research output.', daysAgo: 41 });
  addApp('evan@test.com', lecturer, { qualification: 'PhD', years: 3, pubs: 0, sems: 2, status: 'Shortlisted', note: MET, shortlisted: true, daysAgo: 40 });
  addApp('fiona@test.com', lecturer, { qualification: 'Master', years: 4, pubs: 3, sems: 2, status: 'Shortlisted', note: MET, shortlisted: true, daysAgo: 39 });

  // Senior Lecturer - Physics (different scheme and maxima). Alice applied to both vacancies: same CV, different academic score.
  addApp('alice@test.com', physics, { qualification: 'PhD', years: 8, pubs: 6, sems: 5, daysAgo: 4 });
  addApp('grace@test.com', physics, { qualification: 'Master', years: 6, pubs: 3, sems: 2, daysAgo: 3 });
  addApp('hassan@test.com', physics, { qualification: 'PhD', years: 2, pubs: 5, sems: 1, daysAgo: 2 });

  // Records Officer: Ibrahim passed (8/10 = 80%), Jamila failed (4/10 = 40%), Kabiru is shortlisted and can still sit the test, Lami was rejected.
  addApp('ibrahim@test.com', records, { qualification: 'Bachelor', years: 4, status: 'Shortlisted', note: MET, shortlisted: true, exam: { correct: 8, total: 10 }, daysAgo: 29 });
  addApp('jamila@test.com', records, { qualification: 'Bachelor', years: 3, status: 'Shortlisted', note: MET, shortlisted: true, exam: { correct: 4, total: 10 }, daysAgo: 28 });
  addApp('kabiru@test.com', records, { qualification: 'Bachelor', years: 5, status: 'Shortlisted', note: MET, shortlisted: true, daysAgo: 27 });
  addApp('lami@test.com', records, { qualification: 'Other', years: 0, status: 'Rejected', shortlisted: false, daysAgo: 26,
    note: "Did not meet the requirements: minimum qualification is Bachelor's Degree / HND; minimum experience is 2 year(s)." });

  // ---------------------------------------------------------------- notifications and audit log
  const note = db.prepare('INSERT INTO notifications (user_id, message, link) VALUES (?, ?, ?)');
  note.run(uid('kabiru@test.com'), `Congratulations! You have been shortlisted for "Records Officer". Your computer literacy test opens ${fmtDateTime(records.exam_start)} and closes ${fmtDateTime(records.exam_end)}.`, '/my-applications');
  note.run(uid('ibrahim@test.com'), 'Your examination for "Records Officer" has been marked: 8/10 (80.0%) - PASSED.', '/my-applications');
  note.run(uid('jamila@test.com'), 'Your examination for "Records Officer" has been marked: 4/10 (40.0%) - did not reach the pass mark.', '/my-applications');
  note.run(uid('alice@test.com'), 'You have been recommended for "Lecturer II" following the interview.', '/my-applications');
  note.run(uid('alice@test.com'), 'Your application for "Senior Lecturer - Physics" was received. You will be notified after the closing date about shortlisting.', '/my-applications');

  const log = db.prepare('INSERT INTO audit_logs (user_id, action, description) VALUES (?, ?, ?)');
  log.run(adminId, 'VACANCY_CREATED', 'Created new academic vacancy: Lecturer II (ID 1); points PhD 40, Master 25, Bachelor 10, per year 5, per publication 4, per seminar 2; maxima Qualification 30, Experience 20, Publications 20, Personal data 10, Interview 20; positions 2; academic exam off; Aptitude on; Computer Literacy on.');
  log.run(adminId, 'VACANCY_CREATED', 'Created new academic vacancy: Senior Lecturer - Physics (ID 2); points PhD 30, Master 20, Bachelor 10, per year 4, per publication 3, per seminar 1; maxima Qualification 35, Experience 20, Publications 25, Personal data 10, Interview 10; positions 1; academic exam off; Aptitude on; Computer Literacy on.');
  log.run(adminId, 'VACANCY_CREATED', 'Created new non-academic vacancy: Records Officer (ID 3); Aptitude OFF; Computer Literacy on.');
  log.run(null, 'SHORTLIST_DECISION', 'Automatic shortlisting processed vacancy ID 1 ("Lecturer II"). Shortlisted 6 out of 6 pending applications.');
  log.run(null, 'SHORTLIST_DECISION', 'Automatic shortlisting processed vacancy ID 3 ("Records Officer"). Shortlisted 3 out of 4 pending applications.');
  log.run(adminId, 'EXAM_SCHEDULED', `Exam scheduled for vacancy ID 3: ${fmtDateTime(records.exam_start)} to ${fmtDateTime(records.exam_end)}, pass mark 50%, sections: Computer Literacy, 10 questions per section.`);
  log.run(adminId, 'INTERVIEW_RECORDED', 'Personal data and interview scores recorded for 4 applicants of "Lecturer II".');

  // ---------------------------------------------------------------- summary
  const count = (sql, ...p) => db.prepare(sql).get(...p).c;
  const perVacancy = (v) => count('SELECT COUNT(*) c FROM applications WHERE vacancy_id = ?', v.id);
  console.log('\nSeeding completed successfully. Created:');
  console.log(`  Users: 1 admin + ${applicants.length} applicants`);
  console.log(`  Vacancies: 3, questions: ${count('SELECT COUNT(*) c FROM questions')}, exam results: ${count('SELECT COUNT(*) c FROM exam_results')}`);
  console.log(`  1. "Lecturer II" (academic, closed + shortlisted): maxima 30/20/20/10/20, 2 positions, default points, exam off, ${perVacancy(lecturer)} shortlisted applicants`);
  console.log('       4 have personal data + interview scores (Alice 96, Bob 85, Charlie 84.5, Diana 60); Evan and Fiona have none -> "(incomplete)" / "Not ranked yet"');
  console.log(`  2. "Senior Lecturer - Physics" (academic, open): points 30/20/10/4/3/1, maxima 35/20/25/10/10, 1 position, ${perVacancy(physics)} pending applicants (Alice applied to both academic vacancies)`);
  console.log(`  3. "Records Officer" (non-academic, exam on, Aptitude OFF, 15 Computer Literacy questions): ${perVacancy(records)} applicants,`);
  console.log('       Ibrahim passed (80%), Jamila failed (40%), Kabiru can still sit the test, Lami was rejected at shortlisting');
  console.log('\nLogins');
  console.log('  Admin:      admin@buk.edu.ng / password123');
  console.log('  Applicants: alice@test.com, bob@test.com, charlie@test.com, diana@test.com, evan@test.com, fiona@test.com,');
  console.log('              grace@test.com, hassan@test.com, ibrahim@test.com, jamila@test.com, kabiru@test.com, lami@test.com  / pass123');
  console.log('\nWhere to look: Admin > Reports > Examination Results & Merit List (PDF/CSV), the Lecturer II applicants page, and the dashboard.');
};

run().catch((e) => { console.error('Seeding error:', e); process.exit(1); });
