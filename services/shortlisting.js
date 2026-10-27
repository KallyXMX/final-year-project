const db = require('../models/db');
const { levelOf, LEVEL_LABELS } = require('../utils/qualifications');
const { vacancyState, examState } = require('../utils/vacancy');
const { fmtDateTime } = require('../utils/time');
const { notify } = require('./notifications');
const { logAction } = require('./audit');

// Requirement 4.3: verify minimum requirements against the vacancy criteria, shortlist
// qualified applicants automatically, store the result and notify the applicants.
const evaluate = (vacancy, application) => {
  const reasons = [];
  const needLevel = levelOf(vacancy.min_qualification);
  const haveLevel = levelOf(application.highest_qualification);
  if (haveLevel < needLevel) {
    reasons.push(`minimum qualification is ${LEVEL_LABELS[needLevel]}`);
  }
  const needExp = vacancy.min_experience_years || 0;
  if ((application.experience_years || 0) < needExp) {
    reasons.push(`minimum experience is ${needExp} year(s)`);
  }
  if (!application.cv_path) {
    reasons.push('no CV was uploaded');
  }
  return { ok: reasons.length === 0, reasons };
};

const shortlistVacancy = (vacancyId, actorId = null, req = null) => {
  const vacancy = db.prepare('SELECT * FROM vacancies WHERE id = ?').get(vacancyId);
  if (!vacancy) return null;

  const pending = db.prepare("SELECT * FROM applications WHERE vacancy_id = ? AND status = 'Pending'").all(vacancyId);
  const setStatus = db.prepare('UPDATE applications SET status = ?, status_note = ?, shortlisted = ? WHERE id = ?');
  let shortlisted = 0;

  db.transaction(() => {
    for (const app of pending) {
      const verdict = evaluate(vacancy, app);
      if (verdict.ok) {
        shortlisted++;
        let note = 'Meets the minimum requirements for this vacancy.';
        let msg = `Congratulations! You have been shortlisted for "${vacancy.title}".`;
        if (vacancy.category === 'non-academic') {
          msg += examState(vacancy) === 'NotScheduled'
            ? ' You will be notified when the aptitude and computer literacy tests are scheduled.'
            : ` Your tests open ${fmtDateTime(vacancy.exam_start)} and close ${fmtDateTime(vacancy.exam_end)}.`;
        } else {
          msg += ' Your qualifications will be evaluated by the panel ahead of the physical interview.';
        }
        setStatus.run('Shortlisted', note, 1, app.id);
        notify(app.user_id, msg, '/my-applications');
      } else {
        const note = `Did not meet the requirements: ${verdict.reasons.join('; ')}.`;
        setStatus.run('Rejected', note, 0, app.id);
        notify(app.user_id, `Your application for "${vacancy.title}" was not shortlisted (${verdict.reasons.join('; ')}).`, '/my-applications');
      }
    }
    db.prepare("UPDATE vacancies SET shortlisted_at = ? WHERE id = ?").run(new Date().toISOString(), vacancyId);
  })();

  logAction(actorId, 'SHORTLIST_DECISION',
    `${actorId ? 'HR' : 'Automatic'} shortlisting processed vacancy ID ${vacancyId} ("${vacancy.title}"). Shortlisted ${shortlisted} out of ${pending.length} pending applications.`, req);
  return { shortlisted, total: pending.length };
};

// Run by the scheduler: shortlists every vacancy whose application window has closed.
const runDueShortlisting = () => {
  const open = db.prepare('SELECT * FROM vacancies WHERE is_active = 1 AND shortlisted_at IS NULL').all();
  const done = [];
  for (const v of open) {
    if (vacancyState(v) === 'Closed') {
      const r = shortlistVacancy(v.id, null);
      if (r) done.push({ id: v.id, ...r });
    }
  }
  return done;
};

module.exports = { evaluate, shortlistVacancy, runDueShortlisting };
