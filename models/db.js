const Database = require('better-sqlite3');
const path = require('path');

// Database path in root directory
const dbPath = path.join(__dirname, '..', 'buk_recruitment.db');
const db = new Database(dbPath);

// Enable foreign key constraints
db.pragma('foreign_keys = ON');

// Create tables if they do not exist
const initSchema = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      email TEXT UNIQUE,
      password TEXT,
      role TEXT DEFAULT 'applicant',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS vacancies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      department TEXT,
      description TEXT,
      requirements TEXT,
      deadline TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      vacancy_id INTEGER,
      status TEXT DEFAULT 'Pending',
      exam_completed INTEGER DEFAULT 0,
      exam_score REAL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (vacancy_id) REFERENCES vacancies(id)
    );

    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vacancy_id INTEGER,
      question_text TEXT,
      option_a TEXT,
      option_b TEXT,
      option_c TEXT,
      option_d TEXT,
      correct_option TEXT,
      FOREIGN KEY (vacancy_id) REFERENCES vacancies(id)
    );

    CREATE TABLE IF NOT EXISTS exam_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      vacancy_id INTEGER,
      score INTEGER,
      total_questions INTEGER,
      percentage REAL,
      passed INTEGER,
      submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (vacancy_id) REFERENCES vacancies(id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT,
      description TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // Add columns to existing tables if they don't exist
  try { db.prepare('ALTER TABLE exam_results ADD COLUMN percentage REAL').run(); } catch (e) {}
  try { db.prepare('ALTER TABLE exam_results ADD COLUMN passed INTEGER').run(); } catch (e) {}
  try { db.prepare('ALTER TABLE applications ADD COLUMN exam_completed INTEGER DEFAULT 0').run(); } catch (e) {}
  try { db.prepare('ALTER TABLE applications ADD COLUMN exam_score REAL').run(); } catch (e) {}

  // Add academic columns
  try { db.prepare("ALTER TABLE applications ADD COLUMN highest_qualification TEXT").run(); } catch (e) {}
  try { db.prepare("ALTER TABLE applications ADD COLUMN teaching_experience_years INTEGER DEFAULT 0").run(); } catch (e) {}
  try { db.prepare("ALTER TABLE applications ADD COLUMN journal_publications_count INTEGER DEFAULT 0").run(); } catch (e) {}
  try { db.prepare("ALTER TABLE applications ADD COLUMN seminars_attended INTEGER DEFAULT 0").run(); } catch (e) {}
  try { db.prepare("ALTER TABLE applications ADD COLUMN academic_score INTEGER DEFAULT 0").run(); } catch (e) {}

  // Add interview columns
  try { db.prepare("ALTER TABLE applications ADD COLUMN interview_score INTEGER").run(); } catch (e) {}
  try { db.prepare("ALTER TABLE applications ADD COLUMN interviewer_remarks TEXT").run(); } catch (e) {}

  // Add document upload columns
  try { db.prepare("ALTER TABLE applications ADD COLUMN cv_path TEXT").run(); } catch (e) {}
  try { db.prepare("ALTER TABLE applications ADD COLUMN supporting_documents_path TEXT").run(); } catch (e) {}
};

initSchema();

module.exports = db;
