// Data access for vacancies (Requirement 4.1). Controllers call these instead of writing SQL.
const db = require('../models/db');

const findById = (id) => db.prepare('SELECT * FROM vacancies WHERE id = ?').get(id);

// Vacancies that have not been withdrawn (is_active = 1).
const findActiveById = (id) => db.prepare('SELECT * FROM vacancies WHERE id = ? AND is_active = 1').get(id);

const listActive = () => db.prepare('SELECT * FROM vacancies WHERE is_active = 1').all();

// Public vacancy list with the number of applications on each.
const listWithApplicationCount = () => db.prepare(`
  SELECT v.*, (SELECT COUNT(*) FROM applications a WHERE a.vacancy_id = v.id) AS application_count
  FROM vacancies v WHERE v.is_active = 1 ORDER BY v.created_at DESC, v.id DESC`).all();

const listTitles = () => db.prepare('SELECT id, title FROM vacancies ORDER BY title').all();

// Vacancies that use the online exam: all non-academic ones plus academic ones where HR switched it on.
const listWithExam = () =>
  db.prepare("SELECT id, title FROM vacancies WHERE category = 'non-academic' OR academic_exam_enabled = 1 ORDER BY title").all();

const create = (v) => db.prepare(`
  INSERT INTO vacancies (title, department, category, description, requirements, min_qualification, min_experience_years, opens_at, deadline,
    pts_phd, pts_master, pts_bachelor, pts_per_year, pts_per_publication, pts_per_seminar, academic_exam_enabled, aptitude_enabled, literacy_enabled,
    max_qualification, max_experience, max_publications, max_personal_data, max_interview, slots)
  VALUES (@title, @department, @category, @description, @requirements, @min_qualification, @min_experience_years, @opens_at, @deadline,
    @pts_phd, @pts_master, @pts_bachelor, @pts_per_year, @pts_per_publication, @pts_per_seminar, @academic_exam_enabled, @aptitude_enabled, @literacy_enabled,
    @max_qualification, @max_experience, @max_publications, @max_personal_data, @max_interview, @slots)`).run(v);

// Saves the points scheme, category maxima, number of positions and exam switches; recalculates every applicant's academic score from the new points (capped at 100).
const saveSettings = (id, s, rescore) => db.transaction(() => {
  db.prepare(`UPDATE vacancies SET pts_phd = @pts_phd, pts_master = @pts_master, pts_bachelor = @pts_bachelor, pts_per_year = @pts_per_year,
    pts_per_publication = @pts_per_publication, pts_per_seminar = @pts_per_seminar, academic_exam_enabled = @academic_exam_enabled,
    aptitude_enabled = @aptitude_enabled, literacy_enabled = @literacy_enabled, max_qualification = @max_qualification, max_experience = @max_experience,
    max_publications = @max_publications, max_personal_data = @max_personal_data, max_interview = @max_interview, slots = @slots WHERE id = @id`).run({ ...s, id });
  if (rescore) rescore();
})();

// closed_at = ISO time closes the vacancy early; null reopens it.
const setClosedAt = (id, iso) => db.prepare('UPDATE vacancies SET closed_at = ? WHERE id = ?').run(iso, id);

const saveExamSettings = (id, s) => db.prepare(`
  UPDATE vacancies SET exam_start = ?, exam_end = ?, aptitude_minutes = ?, literacy_minutes = ?, aptitude_weight = ?,
  literacy_weight = ?, pass_mark = ?, questions_per_section = ? WHERE id = ?`)
  .run(s.exam_start, s.exam_end, s.aptitude_minutes, s.literacy_minutes, s.aptitude_weight, s.literacy_weight, s.pass_mark, s.questions_per_section, id);

module.exports = { findById, findActiveById, listActive, listWithApplicationCount, listTitles, listWithExam, create, saveSettings, setClosedAt, saveExamSettings };
