const db = require('../models/db');

// Calculate and save academic score
const calculateAcademicScore = (req, res) => {
  try {
    const applicationId = req.params.id;
    const { highest_qualification, teaching_experience_years, journal_publications_count, seminars_attended } = req.body;

    let degreePoints = 0;
    const hq = highest_qualification ? highest_qualification.toString().toLowerCase() : '';
    if (hq.includes('phd') || hq.includes('doctorate')) {
      degreePoints = 40;
    } else if (hq.includes('master')) {
      degreePoints = 25;
    } else if (hq.includes('bachelor') || hq.includes('bsc') || hq.includes('ba')) {
      degreePoints = 10;
    }

    const expYears = parseInt(teaching_experience_years) || 0;
    const expPoints = expYears * 5;

    const journals = parseInt(journal_publications_count) || 0;
    const seminars = parseInt(seminars_attended) || 0;
    const pubPoints = (journals * 4) + (seminars * 2);

    const academic_score = degreePoints + expPoints + pubPoints;

    const stmt = db.prepare(`
      UPDATE applications
      SET highest_qualification = ?,
          teaching_experience_years = ?,
          journal_publications_count = ?,
          seminars_attended = ?,
          academic_score = ?
      WHERE id = ?
    `);

    stmt.run(
      highest_qualification || '',
      expYears,
      journals,
      seminars,
      academic_score,
      applicationId
    );

    // If it's an API call or form submission, we can redirect or return JSON
    if (req.accepts('json')) {
      return res.json({ success: true, academic_score });
    }
    return res.redirect('back');
  } catch (error) {
    console.error('Error calculating academic score:', error);
    return res.status(500).render('500');
  }
};

// Render academic summary for admin panel
const renderAcademicSummary = (req, res) => {
  try {
    if (!req.session || req.session.role !== 'admin') {
      return res.status(403).send('Access denied: Admins only.');
    }

    const applicationId = req.params.id;
    const application = db.prepare(`
      SELECT a.*, u.name as applicant_name, v.title as vacancy_title, v.department
      FROM applications a
      JOIN users u ON a.user_id = u.id
      JOIN vacancies v ON a.vacancy_id = v.id
      WHERE a.id = ?
    `).get(applicationId);

    if (!application) {
      return res.status(404).send('Application not found.');
    }

    let degreePoints = 0;
    const hq = application.highest_qualification ? application.highest_qualification.toString().toLowerCase() : '';
    if (hq.includes('phd') || hq.includes('doctorate')) {
      degreePoints = 40;
    } else if (hq.includes('master')) {
      degreePoints = 25;
    } else if (hq.includes('bachelor') || hq.includes('bsc') || hq.includes('ba')) {
      degreePoints = 10;
    }

    const expPoints = (application.teaching_experience_years || 0) * 5;
    const pubPoints = ((application.journal_publications_count || 0) * 4) + ((application.seminars_attended || 0) * 2);

    return res.render('admin-academic-summary', {
      application,
      breakdown: {
        degreePoints,
        expPoints,
        pubPoints
      },
      user: req.session
    });
  } catch (error) {
    console.error('Error rendering academic summary:', error);
    return res.status(500).render('500');
  }
};

// Automatic Shortlisting Module
const runAutoShortlist = (req, res) => {
  try {
    if (!req.session || req.session.role !== 'admin') {
      return res.status(403).send('Access denied: Admins only.');
    }

    const vacancyId = req.params.id;
    const vacancy = db.prepare('SELECT * FROM vacancies WHERE id = ?').get(vacancyId);
    
    if (!vacancy) {
      return res.status(404).send('Vacancy not found.');
    }

    // Heuristics to extract requirements from text
    let minExp = 0;
    const expMatch = vacancy.requirements.match(/(\d+)\s*(?:years?|yrs?)\b/i);
    if (expMatch) minExp = parseInt(expMatch[1], 10);

    let requiredLevel = 1; // 1=Bachelor, 2=Master, 3=PhD
    const reqStr = vacancy.requirements.toLowerCase();
    if (reqStr.includes('phd') || reqStr.includes('doctorate')) {
      requiredLevel = 3;
    } else if (reqStr.includes('master')) {
      requiredLevel = 2;
    }

    // Fetch pending applications
    const applications = db.prepare(`
      SELECT id, highest_qualification, teaching_experience_years 
      FROM applications 
      WHERE vacancy_id = ? AND status = 'Pending'
    `).all(vacancyId);

    let shortlistedCount = 0;

    const updateStmt = db.prepare('UPDATE applications SET status = ? WHERE id = ?');

    // Run shortlisting in a transaction for better performance
    const transaction = db.transaction((apps) => {
      for (const app of apps) {
        let appLevel = 0;
        const hq = app.highest_qualification ? app.highest_qualification.toLowerCase() : '';
        if (hq.includes('phd') || hq.includes('doctorate')) appLevel = 3;
        else if (hq.includes('master')) appLevel = 2;
        else if (hq.includes('bachelor') || hq.includes('bsc') || hq.includes('ba')) appLevel = 1;

        const appExp = app.teaching_experience_years || 0;

        let status = 'Rejected';
        if (appLevel >= requiredLevel && appExp >= minExp) {
          status = 'Shortlisted';
          shortlistedCount++;
        }

        updateStmt.run(status, app.id);
      }
    });

    transaction(applications);

    const auditController = require('./auditController');
    auditController.logAction(req.session.userId, 'SHORTLIST_DECISION', `Auto-shortlisting engine processed vacancy ID ${vacancyId}. Shortlisted ${shortlistedCount} out of ${applications.length} applications.`);

    return res.redirect(`/vacancies/${vacancyId}/applications?shortlisted=${shortlistedCount}&total=${applications.length}`);
  } catch (error) {
    console.error('Error running auto-shortlist:', error);
    return res.status(500).render('500');
  }
};

const recordInterviewResult = (req, res) => {
  try {
    if (!req.session || req.session.role !== 'admin') {
      return res.status(403).send('Access denied: Admins only.');
    }

    const applicationId = req.params.id;
    const { interview_score, interviewer_remarks } = req.body;
    
    let status = 'Shortlisted'; // keep as is or modify logic based on final decision if passed, for now keep Shortlisted or update based on score if we want.
    // The requirement says: "Optionally update the overall application status to 'Recommended' or 'Rejected' based on the HR panel's final decision."
    // Let's rely on a 'final_decision' from the body if present, or just leave it. We'll extract 'final_decision' as well.
    const final_decision = req.body.final_decision;
    if (final_decision === 'Recommended' || final_decision === 'Rejected') {
      status = final_decision;
    }

    const stmt = db.prepare(`
      UPDATE applications 
      SET interview_score = ?, interviewer_remarks = ?, status = ?
      WHERE id = ?
    `);

    stmt.run(interview_score, interviewer_remarks, status, applicationId);

    return res.redirect('back');
  } catch (error) {
    console.error('Error recording interview result:', error);
    return res.status(500).render('500');
  }
};

const getAllApplications = (req, res) => {
  try {
    if (!req.session || req.session.role !== 'admin') {
      return res.status(403).send('Access denied: Admins only.');
    }

    const { search, status, vacancy_id } = req.query;
    let queryStr = `
      SELECT a.*, u.name as applicant_name, u.email as applicant_email, v.title as vacancy_title, er.score, er.total_questions
      FROM applications a
      JOIN users u ON a.user_id = u.id
      JOIN vacancies v ON a.vacancy_id = v.id
      LEFT JOIN exam_results er ON er.user_id = a.user_id AND er.vacancy_id = a.vacancy_id
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      queryStr += ` AND (u.name LIKE ? OR u.email LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }
    if (status) {
      queryStr += ` AND a.status = ?`;
      params.push(status);
    }
    if (vacancy_id) {
      queryStr += ` AND a.vacancy_id = ?`;
      params.push(vacancy_id);
    }

    queryStr += ` ORDER BY a.applied_at DESC`;

    const applications = db.prepare(queryStr).all(...params);
    const vacancies = db.prepare('SELECT id, title FROM vacancies ORDER BY title ASC').all();

    return res.render('admin/applications', {
      applications,
      vacancies,
      query: req.query,
      user: req.session
    });
  } catch (error) {
    console.error('Error fetching all applications:', error);
    return res.status(500).render('500');
  }
};

module.exports = {
  calculateAcademicScore,
  renderAcademicSummary,
  runAutoShortlist,
  recordInterviewResult,
  getAllApplications
};
