// Fixed values used across the system, kept in one place so they are easy to find and explain.

// Life cycle of an application:
//   Pending -> Shortlisted | Rejected      (automatic shortlisting, Requirement 4.3)
//   Shortlisted -> Recommended | Rejected  (panel decision after the interview, Requirement 4.6)
//   Shortlisted / Recommended -> Accepted  (final HR decision, Requirement 2.8)
const STATUS = {
  PENDING: 'Pending',
  SHORTLISTED: 'Shortlisted',
  RECOMMENDED: 'Recommended',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected'
};
const ALL_STATUSES = Object.values(STATUS);

// Highest-qualification choices on the application form (vacancies may also use 'None' = no minimum).
const QUALIFICATIONS = ['Bachelor', 'Master', 'PhD', 'Other'];

// Vacancy categories (Requirement 2.5 / 2.6): they follow different workflows after shortlisting.
const CATEGORY = { ACADEMIC: 'academic', NON_ACADEMIC: 'non-academic' };

module.exports = { STATUS, ALL_STATUSES, QUALIFICATIONS, CATEGORY };
