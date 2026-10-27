const Database = require('better-sqlite3');
const path = require('path');

// DB_PATH lets tests use a throw-away database.
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'buk_recruitment.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Add a column to an existing table only if it is missing (safe migration for older databases).
const addColumn = (table, column, definition) => {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
};

const initSchema = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'applicant' CHECK (role IN ('applicant','admin')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS vacancies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      department TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'non-academic' CHECK (category IN ('academic','non-academic')),
      description TEXT,
      requirements TEXT,
      min_qualification TEXT DEFAULT 'Bachelor',
      min_experience_years INTEGER DEFAULT 0,
      opens_at TEXT,
      deadline TEXT,
      closed_at TEXT,
      shortlisted_at TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      vacancy_id INTEGER NOT NULL,
      status TEXT DEFAULT 'Pending',
      status_note TEXT,
      shortlisted INTEGER DEFAULT 0,
      phone TEXT,
      address TEXT,
      highest_qualification TEXT,
      experience_years INTEGER DEFAULT 0,
      qualifications_text TEXT,
      experience_text TEXT,
      publications_text TEXT,
      seminars_text TEXT,
      journal_publications_count INTEGER DEFAULT 0,
      seminars_attended INTEGER DEFAULT 0,
      academic_score INTEGER DEFAULT 0,
      exam_completed INTEGER DEFAULT 0,
      exam_score REAL,
      interview_score INTEGER,
      interviewer_remarks TEXT,
      cv_path TEXT,
      supporting_documents_path TEXT,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (vacancy_id) REFERENCES vacancies(id)
    );

    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vacancy_id INTEGER NOT NULL,
      section TEXT NOT NULL DEFAULT 'Aptitude',
      question_text TEXT NOT NULL,
      option_a TEXT, option_b TEXT, option_c TEXT, option_d TEXT,
      correct_option TEXT NOT NULL,
      FOREIGN KEY (vacancy_id) REFERENCES vacancies(id)
    );

    CREATE TABLE IF NOT EXISTS exam_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      vacancy_id INTEGER NOT NULL,
      sections_json TEXT NOT NULL,
      current_section INTEGER DEFAULT 0,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      FOREIGN KEY (application_id) REFERENCES applications(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (vacancy_id) REFERENCES vacancies(id)
    );

    CREATE TABLE IF NOT EXISTS exam_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      vacancy_id INTEGER NOT NULL,
      score INTEGER,
      total_questions INTEGER,
      percentage REAL,
      passed INTEGER,
      section_scores TEXT,
      submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (vacancy_id) REFERENCES vacancies(id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      link TEXT,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT,
      description TEXT,
      ip TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS login_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      session_id TEXT,
      ip TEXT,
      user_agent TEXT,
      login_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      logout_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS http_sessions (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expires INTEGER NOT NULL
    );
  `);

  // ---- Migrations for databases created by earlier versions of the project ----
  addColumn('vacancies', 'category', "TEXT NOT NULL DEFAULT 'non-academic'");
  addColumn('vacancies', 'min_qualification', "TEXT DEFAULT 'Bachelor'");
  addColumn('vacancies', 'min_experience_years', 'INTEGER DEFAULT 0');
  addColumn('vacancies', 'opens_at', 'TEXT');
  addColumn('vacancies', 'closed_at', 'TEXT');
  addColumn('vacancies', 'shortlisted_at', 'TEXT');
  // Exam scheduling / configuration (Requirement 4.4)
  addColumn('vacancies', 'exam_start', 'TEXT');
  addColumn('vacancies', 'exam_end', 'TEXT');
  addColumn('vacancies', 'aptitude_minutes', 'INTEGER DEFAULT 20');
  addColumn('vacancies', 'literacy_minutes', 'INTEGER DEFAULT 20');
  addColumn('vacancies', 'aptitude_weight', 'INTEGER DEFAULT 50');
  addColumn('vacancies', 'literacy_weight', 'INTEGER DEFAULT 50');
  addColumn('vacancies', 'pass_mark', 'INTEGER DEFAULT 50');
  addColumn('vacancies', 'questions_per_section', 'INTEGER DEFAULT 10');
  addColumn('vacancies', 'exam_notified_at', 'TEXT');

  addColumn('applications', 'status_note', 'TEXT');
  addColumn('applications', 'shortlisted', 'INTEGER DEFAULT 0');
  addColumn('applications', 'phone', 'TEXT');
  addColumn('applications', 'address', 'TEXT');
  addColumn('applications', 'highest_qualification', 'TEXT');
  addColumn('applications', 'experience_years', 'INTEGER DEFAULT 0');
  addColumn('applications', 'qualifications_text', 'TEXT');
  addColumn('applications', 'experience_text', 'TEXT');
  addColumn('applications', 'publications_text', 'TEXT');
  addColumn('applications', 'seminars_text', 'TEXT');
  addColumn('applications', 'journal_publications_count', 'INTEGER DEFAULT 0');
  addColumn('applications', 'seminars_attended', 'INTEGER DEFAULT 0');
  addColumn('applications', 'academic_score', 'INTEGER DEFAULT 0');
  addColumn('applications', 'exam_completed', 'INTEGER DEFAULT 0');
  addColumn('applications', 'exam_score', 'REAL');
  addColumn('applications', 'interview_score', 'INTEGER');
  addColumn('applications', 'interviewer_remarks', 'TEXT');
  addColumn('applications', 'cv_path', 'TEXT');
  addColumn('applications', 'supporting_documents_path', 'TEXT');
  // Older versions stored experience in teaching_experience_years.
  const legacy = db.prepare('PRAGMA table_info(applications)').all().some((c) => c.name === 'teaching_experience_years');
  if (legacy) {
    db.exec('UPDATE applications SET experience_years = teaching_experience_years WHERE (experience_years IS NULL OR experience_years = 0) AND teaching_experience_years IS NOT NULL');
  }

  db.exec("UPDATE applications SET shortlisted = 1 WHERE shortlisted = 0 AND status IN ('Shortlisted','Recommended','Accepted')");

  addColumn('questions', 'section', "TEXT NOT NULL DEFAULT 'Aptitude'");
  addColumn('exam_results', 'percentage', 'REAL');
  addColumn('exam_results', 'passed', 'INTEGER');
  addColumn('exam_results', 'section_scores', 'TEXT');
  addColumn('audit_logs', 'ip', 'TEXT');

  // One application and one exam result per applicant per vacancy.
  // (Skipped silently if legacy data already contains duplicates.)
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_applications_user_vacancy ON applications(user_id, vacancy_id)'); } catch (e) {}
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_exam_results_user_vacancy ON exam_results(user_id, vacancy_id)'); } catch (e) {}
  db.exec('CREATE INDEX IF NOT EXISTS ix_notifications_user ON notifications(user_id, is_read)');
  db.exec('CREATE INDEX IF NOT EXISTS ix_questions_vacancy ON questions(vacancy_id, section)');
  db.exec('CREATE INDEX IF NOT EXISTS ix_attempts_app ON exam_attempts(application_id)');
};

initSchema();

module.exports = db;
