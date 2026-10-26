const db = require('../models/db');

// Retrieve all active vacancies
const getAllVacancies = (req, res) => {
  try {
    const vacancies = db.prepare('SELECT * FROM vacancies WHERE is_active = 1 ORDER BY created_at DESC').all();
    const user = req.session || {};
    const successMessage = req.query.success || null;
    const errorMessage = req.query.error || null;
    return res.render('vacancies', { vacancies, user, successMessage, errorMessage });
  } catch (error) {
    console.error('Error fetching vacancies:', error);
    return res.status(500).render('500');
  }
};

// Create a new vacancy (admin only)
const createVacancy = (req, res) => {
  try {
    // Authorization check: ensure user is logged in with admin role
    if (!req.session || req.session.role !== 'admin') {
      return res.status(403).send('Access denied: Admins only.');
    }

    const { title, department, description, requirements, deadline } = req.body;

    if (!title || !department) {
      return res.status(400).send('Title and department are required.');
    }

    const stmt = db.prepare(`
      INSERT INTO vacancies (title, department, description, requirements, deadline)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(title, department, description || '', requirements || '', deadline || '');

    return res.redirect('/vacancies');
  } catch (error) {
    console.error('Error creating vacancy:', error);
    return res.status(500).render('500');
  }
};

// Apply to a vacancy (applicant)
const applyToVacancy = (req, res) => {
  try {
    const userId = req.session ? req.session.userId : null;
    const vacancyId = req.params.id;

    if (!userId) {
      return res.redirect('/login');
    }

    const vacancy = db.prepare('SELECT deadline FROM vacancies WHERE id = ?').get(vacancyId);
    if (vacancy && vacancy.deadline) {
      const deadlineDate = new Date(vacancy.deadline);
      if (new Date() > deadlineDate) {
        return res.redirect('/vacancies?error=Application+closed:+The+deadline+for+this+vacancy+has+passed.');
      }
    }

    let cvPath = null;
    let supportingDocsPath = null;

    if (req.files) {
      if (req.files.cv && req.files.cv.length > 0) {
        cvPath = '/uploads/documents/' + req.files.cv[0].filename;
      }
      if (req.files.supporting_docs && req.files.supporting_docs.length > 0) {
        supportingDocsPath = '/uploads/documents/' + req.files.supporting_docs[0].filename;
      }
    }

    const stmt = db.prepare(`
      INSERT INTO applications (user_id, vacancy_id, status, cv_path, supporting_documents_path)
      VALUES (?, ?, 'Pending', ?, ?)
    `);

    stmt.run(userId, vacancyId, cvPath, supportingDocsPath);

    return res.redirect('/vacancies?success=Application+submitted+successfully!');
  } catch (error) {
    console.error('Error applying to vacancy:', error);
    return res.status(500).render('500');
  }
};

// Retrieve applications for the current logged-in user
const getMyApplications = (req, res) => {
  try {
    const userId = req.session ? req.session.userId : null;

    if (!userId) {
      return res.redirect('/login');
    }

    const applications = db.prepare(`
      SELECT 
        a.id,
        a.vacancy_id,
        a.status,
        a.applied_at,
        v.title AS job_title,
        v.department
      FROM applications a
      JOIN vacancies v ON a.vacancy_id = v.id
      WHERE a.user_id = ?
      ORDER BY a.applied_at DESC
    `).all(userId);

    return res.render('my-applications', {
      applications,
      user: req.session
    });
  } catch (error) {
    console.error('Error fetching user applications:', error);
    return res.status(500).render('500');
  }
};

// View all applications for a specific vacancy (admin only)
const viewVacancyApplications = (req, res) => {
  try {
    if (!req.session || req.session.role !== 'admin') {
      return res.status(403).send('Access denied: Admins only.');
    }

    const vacancyId = req.params.id;
    const vacancy = db.prepare('SELECT * FROM vacancies WHERE id = ?').get(vacancyId);
    if (!vacancy) {
      return res.status(404).send('Vacancy not found.');
    }

    const applications = db.prepare(`
      SELECT 
        a.id,
        a.user_id,
        a.vacancy_id,
        a.status,
        a.applied_at,
        u.name AS applicant_name,
        u.email AS applicant_email,
        er.score,
        er.total_questions
      FROM applications a
      JOIN users u ON a.user_id = u.id
      LEFT JOIN exam_results er ON er.user_id = a.user_id AND er.vacancy_id = a.vacancy_id
      WHERE a.vacancy_id = ?
      ORDER BY a.applied_at DESC
    `).all(vacancyId);

    return res.render('admin-applications', {
      applications,
      vacancy,
      vacancyId,
      user: req.session
    });
  } catch (error) {
    console.error('Error fetching vacancy applications:', error);
    return res.status(500).render('500');
  }
};

// Update status of an application (admin only)
const updateApplicationStatus = (req, res) => {
  try {
    if (!req.session || req.session.role !== 'admin') {
      return res.status(403).send('Access denied: Admins only.');
    }

    const applicationId = req.params.applicationId;
    const { status } = req.body;

    if (!status || !['Accepted', 'Rejected'].includes(status)) {
      return res.status(400).send('Invalid status. Must be "Accepted" or "Rejected".');
    }

    const application = db.prepare('SELECT vacancy_id FROM applications WHERE id = ?').get(applicationId);
    if (!application) {
      return res.status(404).send('Application not found.');
    }

    db.prepare('UPDATE applications SET status = ? WHERE id = ?').run(status, applicationId);

    return res.redirect(`/vacancies/${application.vacancy_id}/applications`);
  } catch (error) {
    console.error('Error updating application status:', error);
    return res.status(500).render('500');
  }
};

// Get admin analytics and render dashboard
const getAdminAnalytics = (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.redirect('/login');
  }

  try {
    const userData = db.prepare('SELECT id, name, email, role, created_at FROM users WHERE id = ?').get(req.session.userId);
    if (!userData) {
      return res.redirect('/login');
    }

    let analytics = null;
    let myApplications = [];
    if (userData.role === 'admin') {
      const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
      const totalVacancies = db.prepare('SELECT COUNT(*) as count FROM vacancies WHERE is_active = 1').get().count;
      const totalApplications = db.prepare('SELECT COUNT(*) as count FROM applications').get().count;
      const averageScoreRow = db.prepare('SELECT AVG(score) as avg FROM exam_results').get();
      const averageScore = averageScoreRow.avg ? parseFloat(averageScoreRow.avg).toFixed(2) : 0;

      // Fetch status distribution for Chart.js
      const statusRows = db.prepare(`
        SELECT status, COUNT(*) as count FROM applications GROUP BY status
      `).all();
      const statusCounts = { Pending: 0, Shortlisted: 0, Recommended: 0, Rejected: 0, Accepted: 0 };
      statusRows.forEach(row => {
        if (statusCounts.hasOwnProperty(row.status)) {
          statusCounts[row.status] = row.count;
        }
      });

      analytics = {
        totalUsers,
        totalVacancies,
        totalApplications,
        averageScore,
        statusCounts
      };
    } else {
      myApplications = db.prepare(`
        SELECT a.*, v.title as vacancy_title
        FROM applications a
        JOIN vacancies v ON a.vacancy_id = v.id
        WHERE a.user_id = ?
        ORDER BY a.applied_at DESC
      `).all(req.session.userId);
    }

    return res.render('dashboard', { user: userData, analytics, myApplications, error: req.query.error });
  } catch (error) {
    console.error('Error fetching dashboard analytics:', error);
    return res.status(500).render('500');
  }
};

module.exports = {
  getAllVacancies,
  createVacancy,
  applyToVacancy,
  getMyApplications,
  viewVacancyApplications,
  updateApplicationStatus,
  getAdminAnalytics
};
