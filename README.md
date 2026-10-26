# BUK Staff Recruitment & Examination System

This is a full-stack Node.js MVC application designed to automate Bayero University Kano (BUK) recruitment processes, streamlining candidate shortlisting and facilitating secure computer-based testing (CBT).

## Tech Stack & Features

**Core Technologies:**
- **Backend:** Node.js, Express.js
- **Database:** better-sqlite3
- **Templating:** EJS (Embedded JavaScript)
- **Security:** bcrypt (Password Hashing)
- **File Uploads:** multer

**Main Features:**
- **Role-Based Access Control (RBAC):** Distinct dashboards and capabilities for Administrators and Applicants.
- **Automated Shortlisting:** HR engine automatically evaluates applicant qualifications against minimum vacancy requirements.
- **CBT Engine:** Dynamic, randomized, and timed computer-based testing for non-academic recruitment.
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
