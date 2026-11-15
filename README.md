# BUK Staff Recruitment & Examination System

This is a full-stack Node.js MVC application designed to automate Bayero University Kano (BUK) recruitment processes, streamlining candidate shortlisting and facilitating secure computer-based testing (CBT).

## Tech Stack & Features

**Core Technologies:**
- **Frontend / Views:** HTML5, CSS3, JavaScript, EJS templating (server-rendered pages)
- **Backend / Application:** Node.js, Express.js
- **Database:** SQLite (via better-sqlite3)
- **Security:** bcrypt (password hashing), express-session (SQLite-backed sessions), CSRF tokens
- **File Uploads:** multer (private storage, served only to the owner or HR)
- **Reports / Charts:** PDFKit (PDF), csv-writer (CSV), Chart.js (HR dashboard)

**Main Features:**
- **Role-Based Access Control (RBAC):** Distinct dashboards and capabilities for Administrators and Applicants.
- **Automated Shortlisting:** HR engine automatically evaluates applicant qualifications against minimum vacancy requirements. The notification each shortlisted applicant receives names only the test sections that are switched on for that vacancy.
- **CBT Engine:** Dynamic, randomized, and timed computer-based testing. It is always used for non-academic vacancies and is optional for academic ones.
- **Per-vacancy points scheme:** HR sets the academic points for each vacancy (PhD / Master / Bachelor, per year of experience, per publication, per seminar). The same applicant can therefore score differently in different departments. Changing the scheme recalculates the academic scores of that vacancy's applicants. Changes are audit-logged.
- **Combined recruitment score (academic vacancies):** HR splits 100 points between five categories: educational qualification, relevant experience, publications and seminars (one shared cap), personal data and the physical interview. The five maxima must add up to exactly 100 (the form is pre-filled with 30 / 20 / 20 / 10 / 20); leaving all five empty keeps the older scoring (academic score capped at 100, no combined total).
  - *Academic part* = qualification + experience + publications/seminars, each capped at its own maximum. It is calculated when the applicant applies and again whenever HR corrects the figures or changes the vacancy settings.
  - *Personal data score* and *interview score* are entered by HR for shortlisted candidates (up to two decimals, within their maxima).
  - *Combined total* = academic part + personal data + interview, out of 100. It is calculated when shown, not stored.
  - While either score is missing, the total is shown as, for example, "59 (incomplete)" (missing scores count as 0). Such candidates stay on the merit list but are marked "Not ranked yet", are listed after everyone who has both scores, and never receive the "Within slots" marker.
- **Optional online exam for academic vacancies:** off by default; HR switches it on in the vacancy settings. Academic candidates then appear on the merit list once they have sat the exam.
- **Optional exam sections:** HR can switch the Aptitude or the Computer Literacy section off (at least one stays on). With one section on it counts at full weight. These switches are locked once an applicant has started the exam. When HR saves the exam schedule and a section that is switched on has no questions, a warning names the section and HR can go back and add questions or continue.
- **Positions (slots):** HR can enter the number of positions for a vacancy. The merit list marks that many top-ranked candidates "Within slots". This is a visual marker only; it changes no status.
- **Merit list ranking:** academic vacancies with maxima rank by combined total; other academic vacancies by academic score; non-academic vacancies by weighted exam %. Ties are broken by exam %, then interview score, then the earlier application time, then the application id, so the order is always the same.
- **Final decision rules:** HR can accept only shortlisted or recommended candidates, and an Accepted application is final (the server refuses to change it to Rejected).
- **Document Management:** Secure upload and HR review of Applicant CVs and supporting credentials.
- **Analytics Dashboard:** Real-time metrics on user growth, job vacancies, applications, and average exam scores.
- **PDF/CSV Reports:** Integrated reporting module for exporting HR merit lists and application logs.
- **Audit Logging:** System actions are tracked for robust administrative transparency.

## Installation & Setup Instructions

To get this project running locally on your machine, follow these steps:

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd <repository-directory>
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Initialize and Seed the Database:**
   To automatically create the SQLite database tables and populate the system with mock users, vacancies, exams, and logs, run the database seed script:
   ```bash
   npm run seed
   ```
   The seed clears the existing data and creates the admin account, twelve demo applicants (password `pass123`) and three vacancies that show the current features:
   - **Lecturer II** (academic): maxima 30 / 20 / 20 / 10 / 20, 2 positions, default points, exam off, six shortlisted applicants. Four have personal data and interview scores (two with close totals, Bob 85 and Charlie 84.5); two have none, so the merit list shows ranking, "Within slots" and "(incomplete)" / "Not ranked yet".
   - **Senior Lecturer - Physics** (academic, open): a different points scheme (30 / 20 / 10 / 4 / 3 / 1) and different maxima (35 / 20 / 25 / 10 / 10), 1 position, three pending applicants. Alice applied to both academic vacancies, so you can compare her two academic scores.
   - **Records Officer** (non-academic): exam on with the Aptitude section switched off, 15 Computer Literacy questions, four applicants and two exam results (one pass, one fail). One shortlisted applicant (`kabiru@test.com`) can still sit the test.
   The seed prints a summary of everything it created.

## Running the Application

After installation and database seeding, you can launch the application by running the development server:

```bash
npm run dev
```

The application will be accessible via your browser at [http://localhost:3000](http://localhost:3000).

## Default Credentials

The seed script (`npm run seed`) automatically generates a default administrator account so that evaluators and HR managers can access the dashboard immediately. 

**Admin Login:**
- **Email:** `admin@buk.edu.ng`
- **Password:** `password123`

## Running the Tests

```bash
npm test
```

This runs three end-to-end scripts in order, each against a temporary database and upload folder, so your real data is not touched:

- `tests/e2e.js`: the original requirements (vacancies, applying, shortlisting, the online exam, reports, security) and the "Accepted is final" rule.
- `tests/e2e-vacancy-settings.js`: per-vacancy points scheme, the 100-point cap, the optional academic exam, optional exam sections, the shortlisting message, the empty-section warning, validation and audit logging.
- `tests/e2e-combined-score.js`: category maxima, capped academic parts, personal data and interview scores, the combined total and its "(incomplete)" label, "Not ranked yet", merit-list ranking and stable tie-breaks, positions (slots), and unchanged behaviour for older vacancies.

Each script prints PASS or FAIL for every check and a final `N/M passed` line, and the command stops with an error if any check fails. Add the three `N/M` figures together for the total number of checks.

## Project Structure

The code follows a three-tier layout:

- **Presentation:** `views/` (EJS pages) and `public/css/`.
- **Application:** `routes/` (URL to controller, with access rules), `controllers/` (read the request, call a service, render or redirect), `services/` (the business rules: shortlisting, exam engine, reports, audit, notifications) and `middlewares/` (login/role checks, CSRF, uploads).
- **Data:** `models/db.js` (SQLite schema) and the data-access functions in `services/` (`vacancies`, `applications`, `questions`, `users`, `analytics`).
- Shared fixed values (application statuses, qualification options) are in `utils/constants.js`.
