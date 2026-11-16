// End-to-end test of the requirements (Requirements doc sections 4.1 - 4.8).
// Run with:  npm test
// It uses a throw-away database and upload folder, so your real data is never touched.
const path = require('path');
const os = require('os');
const fs = require('fs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buk-e2e-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');

const root = path.join(__dirname, '..');
const bcrypt = require('bcrypt');
const db = require(path.join(root, 'models/db'));
const { cleanup } = require('./cleanup');
const http = require('http');
const app = require(path.join(root, 'app'));

const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`); };

class Client {
  constructor(base) { this.base = base; this.cookies = {}; }
  async req(method, url, { form, multipart, headers = {} } = {}) {
    const h = { ...headers };
    const ck = Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    if (ck) h.cookie = ck;
    let body;
    if (form) { body = new URLSearchParams(form).toString(); h['content-type'] = 'application/x-www-form-urlencoded'; }
    if (multipart) body = multipart;
    const r = await fetch(this.base + url, { method, headers: h, body, redirect: 'manual' });
    (r.headers.getSetCookie ? r.headers.getSetCookie() : []).forEach((c) => { const [kv] = c.split(';'); const i = kv.indexOf('='); this.cookies[kv.slice(0, i)] = kv.slice(i + 1); });
    const text = await r.text().catch(() => '');
    return { status: r.status, loc: r.headers.get('location'), text, headers: r.headers };
  }
  async token(url = '/login') { const r = await this.req('GET', url); const m = /name="_csrf" value="([^"]+)"/.exec(r.text) || /_csrf=([a-f0-9]+)/.exec(r.text); return m && m[1]; }
  async login(email, password) { const t = await this.token('/login'); return this.req('POST', '/login', { form: { email, password, _csrf: t } }); }
  async post(url, form) { const t = await this.token(this.lastPage || '/vacancies/create'); return this.req('POST', url, { form: { ...form, _csrf: t } }); }
}

(async () => {
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const adminHash = await bcrypt.hash('password123', 4);
  db.prepare("INSERT OR IGNORE INTO users (name,email,password,role) VALUES ('Admin','admin@buk.edu.ng',?, 'admin')").run(adminHash);

  const admin = new Client(base);
  let r = await admin.login('admin@buk.edu.ng', 'password123');
  check('Admin login redirects to dashboard', r.status === 302 && r.loc === '/dashboard');

  // ---- 4.1 create vacancies
  const today = new Date(Date.now() + 3600000).toISOString().slice(0, 10);
  const mkVac = async (o) => admin.post('/vacancies/create', { description: 'd', requirements: 'r', opens_at: today, deadline: today, ...o });
  r = await mkVac({ title: 'Systems Officer', department: 'IT', category: 'non-academic', min_qualification: 'Bachelor', min_experience_years: 1 });
  check('HR creates non-academic vacancy', r.status === 302, r.loc);
  r = await mkVac({ title: 'Lecturer II', department: 'CS', category: 'academic', min_qualification: 'Master', min_experience_years: 2 });
  check('HR creates academic vacancy', r.status === 302);
  r = await mkVac({ title: 'Past', department: 'X', category: 'academic', opens_at: '2020-01-01', deadline: '2020-01-02' });
  check('Deadline in the past rejected', r.status === 400);
  const vac = db.prepare('SELECT * FROM vacancies ORDER BY id').all();
  const [vNA, vAC] = vac;

  // ---- 4.2 applicants
  const pdf = () => new Blob(['%PDF-1.4 test'], { type: 'application/pdf' });
  const mkApplicant = async (n) => {
    const c = new Client(base);
    const t = await c.token('/register');
    let rr = await c.req('POST', '/register', { form: { name: n, email: `${n}@t.com`, password: 'passw0rdX', _csrf: t } });
    if (rr.status !== 302) console.log('register failed', rr.status);
    await c.login(`${n}@t.com`, 'passw0rdX');
    return c;
  };
  const apply = async (c, vid, f) => {
    const page = await c.req('GET', `/vacancies/${vid}/apply`);
    if (page.status === 302) return page;
    const m = /_csrf=([a-f0-9]+)/.exec(page.text);
    const fd = new FormData();
    Object.entries({ phone: '08012345678', address: '1 Kano Road', highest_qualification: 'Bachelor', experience_years: '2', qualifications_text: 'BSc CS', experience_text: 'x', publications_text: 'P1\nP2', seminars_text: 'S1', ...f }).forEach(([k, v]) => { if (v === undefined) return; [].concat(v).forEach((x) => fd.append(k, x)); });
    fd.append('cv', pdf(), 'cv.pdf'); fd.append('supporting_docs', pdf(), 'docs.pdf');
    return c.req('POST', `/vacancies/${vid}/apply?_csrf=${m && m[1]}`, { multipart: fd });
  };
  const good = await mkApplicant('good'), weak = await mkApplicant('weak'), acad = await mkApplicant('acad'), acadWeak = await mkApplicant('acadweak'), acad2 = await mkApplicant('acad2');
  check('Applicant registers + logs in', !!good.cookies['connect.sid']);
  r = await good.req('GET', '/vacancies'); check('Applicant sees vacancies', r.status === 200 && r.text.includes('Systems Officer'));
  r = await apply(good, vNA.id, { experience_years: '3' }); check('Apply with CV + docs (non-academic)', r.status === 302 && /successfully/.test(decodeURIComponent(r.loc)), r.loc);
  r = await apply(weak, vNA.id, { experience_years: '0' }); check('Weak applicant can apply', r.status === 302);
  r = await apply(acad, vAC.id, { highest_qualification: 'PhD', experience_years: '5' }); check('Apply (academic)', r.status === 302);
  r = await apply(acad2, vAC.id, { 'qualifications_text[]': ['BSc CS', 'MSc CS'], 'publications_text[]': ['P1', '', 'P2', 'P3'], 'seminars_text[]': ['S1'], qualifications_text: undefined, publications_text: undefined, seminars_text: undefined });
  const a2 = db.prepare("SELECT * FROM applications WHERE user_id=(SELECT id FROM users WHERE email='acad2@t.com')").get();
  check('Separate entry boxes saved (blank boxes ignored)', r.status === 302 && a2 && a2.qualifications_text === 'BSc CS\nMSc CS' && a2.journal_publications_count === 3 && a2.seminars_attended === 1, a2 && JSON.stringify(a2.publications_text));
  r = await apply(acadWeak, vAC.id, { highest_qualification: 'Bachelor', experience_years: '0' });
  r = await apply(good, vNA.id); check('Duplicate application blocked', /already/.test(decodeURIComponent(r.loc || '')));
  r = await good.req('GET', '/my-applications'); check('Applicant tracks status', r.status === 200 && r.text.includes('Pending'));
  r = await good.req('GET', '/notifications'); check('Applicant notification received', r.status === 200 && r.text.includes('received'));
  const gid = db.prepare("SELECT id FROM applications WHERE user_id=(SELECT id FROM users WHERE email='good@t.com')").get().id;
  r = await weak.req('GET', `/applications/${gid}/documents/cv`); check("Other applicant can't download someone's CV", r.status === 403);
  r = await good.req('GET', `/applications/${gid}/documents/cv`); check('Owner can download own CV', r.status === 200);
  r = await good.req('GET', '/admin/applications'); check('Applicant blocked from admin pages', r.status === 403);
  r = await new Client(base).req('GET', '/admin/reports'); check('Anonymous redirected from admin', r.status === 302);

  // ---- 4.1 search/filter
  r = await admin.req('GET', '/admin/applications?search=good'); check('HR search applicants', r.status === 200 && r.text.includes('good@t.com') && !r.text.includes('weak@t.com'));
  r = await admin.req('GET', `/admin/applications?vacancy_id=${vAC.id}&status=Pending`); check('HR filter applicants', r.status === 200);

  // ---- close + shortlist (auto)
  db.prepare('UPDATE vacancies SET closed_at = ?').run(new Date().toISOString());
  const { runDueShortlisting } = require(path.join(root, 'services/shortlisting'));
  const done = runDueShortlisting(); check('Auto-shortlisting runs after close', done.length === 2, JSON.stringify(done));
  const st = (e) => db.prepare("SELECT status FROM applications WHERE user_id=(SELECT id FROM users WHERE email=?)").get(e).status;
  check('Qualified non-academic shortlisted', st('good@t.com') === 'Shortlisted');
  check('Unqualified non-academic rejected', st('weak@t.com') === 'Rejected');
  check('Qualified academic shortlisted', st('acad@t.com') === 'Shortlisted');
  check('Unqualified academic rejected', st('acadweak@t.com') === 'Rejected');
  // The shortlisting notification lists only the sections that are on (here both), and says nothing about tests when there is no exam.
  const shortlistMsg = (e) => (db.prepare("SELECT message m FROM notifications WHERE user_id=(SELECT id FROM users WHERE email=?) AND message LIKE 'Congratulations%' ORDER BY id DESC").get(e) || {}).m || '';
  check('Shortlisting message names both sections when both are on', /aptitude and computer literacy tests are scheduled/.test(shortlistMsg('good@t.com')), shortlistMsg('good@t.com'));
  check('Shortlisting message for an academic vacancy without an exam does not mention tests', /shortlisted/.test(shortlistMsg('acad@t.com')) && !/aptitude|literacy|test/i.test(shortlistMsg('acad@t.com')), shortlistMsg('acad@t.com'));
  r = await apply(new Client(base), vNA.id); // anon
  const late = await mkApplicant('late'); r = await apply(late, vNA.id); check('Applications refused after close', r.status === 302 && /closed|not open/i.test(decodeURIComponent(r.loc)));

  // ---- 4.4 exam
  const addQ = async (section, i) => admin.post('/questions/create', { vacancy_id: vNA.id, section, question_text: `${section} Q${i}`, option_a: 'a', option_b: 'b', option_c: 'c', option_d: 'd', correct_option: 'B' });
  for (let i = 0; i < 4; i++) { await addQ('Aptitude', i); await addQ('Computer Literacy', i); }
  check('Questions added to bank', db.prepare('SELECT COUNT(*) c FROM questions').get().c === 8);
  const fmt = (d) => new Date(d.getTime() + 3600000).toISOString().slice(0, 16);
  r = await admin.post(`/admin/vacancies/${vNA.id}/exam`, { exam_start: fmt(new Date(Date.now() - 600000)), exam_end: fmt(new Date(Date.now() + 3600000)), aptitude_minutes: 10, literacy_minutes: 10, aptitude_weight: 50, literacy_weight: 50, pass_mark: 50, questions_per_section: 3 });
  check('HR schedules exam', r.status === 302 && /scheduled/i.test(decodeURIComponent(r.loc)), decodeURIComponent(r.loc || ''));
  r = await weak.req('GET', `/exam/${vNA.id}`); check('Rejected applicant cannot sit exam', r.status === 302 && /my-applications/.test(r.loc));
  r = await acad.req('GET', `/exam/${vAC.id}`); check('Academic applicant has no exam', r.status === 302);
  r = await good.req('GET', `/exam/${vNA.id}`); check('Exam instructions page renders', r.status === 200, `status ${r.status}`);
  
  let tok = await good.token(`/exam/${vNA.id}`);
  r = await good.req('POST', `/exam/${vNA.id}/start`, { form: { _csrf: tok } }); check('Start exam', r.status === 302);
  r = await good.req('GET', `/exam/${vNA.id}`); check('Exam section 1 renders', r.status === 200 && /Aptitude/.test(r.text), `status ${r.status}`);
  const ids = [...r.text.matchAll(/name="(q[a-z]*_\d+)"/g)].map((m) => m[1]);
  console.log('   radio field names rendered:', ids.slice(0, 3).join(', '));
  check('Radios use names the engine reads (q_<id>)', ids.length > 0 && ids.every((n) => /^q_\d+$/.test(n)));
  check('Exam form carries CSRF token', /name="_csrf"/.test(r.text));
  const form1 = {}; ids.forEach((n) => { form1[n] = 'B'; });
  tok = (/name="_csrf" value="([^"]+)"/.exec(r.text) || [])[1] || tok;
  r = await good.req('POST', `/exam/${vNA.id}/submit`, { form: { ...form1, section_index: 0, _csrf: tok } }); check('Submit section 1', r.status === 302, String(r.status));
  r = await good.req('GET', `/exam/${vNA.id}`);
  const ids2 = [...r.text.matchAll(/name="(q[a-z]*_\d+)"/g)].map((m) => m[1]); const form2 = {}; ids2.forEach((n) => { form2[n] = 'B'; });
  tok = (/name="_csrf" value="([^"]+)"/.exec(r.text) || [])[1] || tok;
  r = await good.req('POST', `/exam/${vNA.id}/submit`, { form: { ...form2, section_index: 1, _csrf: tok } });
  r = await good.req('GET', `/exam/${vNA.id}/result`); check('Result page renders', r.status === 200, `status ${r.status}`);
  const er = db.prepare('SELECT * FROM exam_results').get();
  check('Exam auto-marked 100% (all answers B)', er && er.percentage === 100, JSON.stringify(er && { p: er.percentage, s: er.score, t: er.total_questions }));

  // timeout / auto-submit + retake protection
  r = await good.req('GET', `/exam/${vNA.id}`); check('Completed exam redirects to result (no retake)', r.status === 302 && /result/.test(r.loc));
  r = await good.req('POST', `/exam/${vNA.id}/start`, { form: { _csrf: tok } }); check('Retake start blocked', db.prepare('SELECT COUNT(*) c FROM exam_attempts WHERE user_id=(SELECT id FROM users WHERE email=?)').get('good@t.com').c === 1);
  const slow = await mkApplicant('slow');
  const uidSlow = db.prepare("SELECT id FROM users WHERE email='slow@t.com'").get().id;
  db.prepare("INSERT INTO applications (user_id,vacancy_id,status,shortlisted,highest_qualification,experience_years,cv_path,supporting_documents_path) VALUES (?,?, 'Shortlisted',1,'Bachelor',3,'x.pdf','y.pdf')").run(uidSlow, vNA.id);
  tok = await slow.token(`/exam/${vNA.id}`);
  await slow.req('POST', `/exam/${vNA.id}/start`, { form: { _csrf: tok } });
  db.prepare("UPDATE exam_attempts SET sections_json = json_set(sections_json, '$[0].started_at', ?) WHERE user_id = ?").run(new Date(Date.now() - 3 * 3600000).toISOString(), uidSlow);
  const { finalizeStaleAttempts } = require(path.join(root, 'services/exam'));
  const n = finalizeStaleAttempts();
  const slowRes = db.prepare('SELECT * FROM exam_results WHERE user_id = ?').get(uidSlow);
  check('Expired attempt auto-submitted and auto-marked (0%, failed)', n === 1 && slowRes && slowRes.percentage === 0 && slowRes.passed === 0, JSON.stringify(slowRes && { p: slowRes.percentage, pass: slowRes.passed }));
  // randomisation: papers differ between attempts
  const { createAttempt } = require(path.join(root, 'services/exam'));
  const papers = new Set();
  for (let i = 0; i < 12; i++) { const a = createAttempt({ id: gid, user_id: db.prepare("SELECT id FROM users WHERE email='good@t.com'").get().id }, db.prepare('SELECT * FROM vacancies WHERE id=?').get(vNA.id)); papers.add(JSON.parse(a.sections_json).map((x) => x.question_ids.join('-')).join('|')); db.prepare('DELETE FROM exam_attempts WHERE id=?').run(a.id); }
  check('Question papers are randomised', papers.size > 1, `${papers.size} distinct papers in 12 draws`);

  // ---- 4.5 academic summary + 4.6 interview
  const aid = db.prepare("SELECT id FROM applications WHERE user_id=(SELECT id FROM users WHERE email='acad@t.com')").get().id;
  r = await admin.req('GET', `/admin/applications/${aid}`); check('Academic qualification summary page', r.status === 200 && /PhD/.test(r.text) && /point/i.test(r.text));
  r = await admin.post(`/admin/applications/${aid}/interview`, { interview_score: 80, interviewer_remarks: 'ok', final_decision: 'Recommended' });
  check('Record interview score + remarks', r.status === 302 && db.prepare('SELECT interview_score s FROM applications WHERE id=?').get(aid).s === 80);

  // ---- 4.7 reports
  for (const t of ['applicants', 'shortlisted', 'merit', 'statistics']) for (const f of ['pdf', 'csv']) {
    const rr = await fetch(`${base}/admin/reports/${t}/${f}`, { headers: { cookie: Object.entries(admin.cookies).map(([k, v]) => `${k}=${v}`).join('; ') } });
    const buf = Buffer.from(await rr.arrayBuffer());
    const ok = rr.status === 200 && (f === 'pdf' ? buf.slice(0, 4).toString() === '%PDF' : buf.toString().split('\n').length > 1);
    check(`Report ${t}.${f}`, ok, `status ${rr.status}, ${buf.length} bytes`);
  }
  r = await admin.req('GET', '/dashboard'); check('Admin analytics dashboard (Chart.js)', r.status === 200 && /chart/i.test(r.text));

  // ---- HR tools and pages that read through the service layer
  r = await admin.post(`/admin/applications/${aid}/academic-score`, { highest_qualification: 'PhD', experience_years: 5, journal_publications_count: 2, seminars_attended: 1 });
  check('HR recalculates academic score (40 + 25 + 8 + 2 = 75)', r.status === 302 && db.prepare('SELECT academic_score s FROM applications WHERE id=?').get(aid).s === 75);
  r = await admin.req('GET', `/admin/vacancies/${vNA.id}/exam`); check('Exam settings page', r.status === 200 && /Pass mark/.test(r.text));
  r = await admin.req('GET', `/admin/vacancies/${vNA.id}/questions`); check('Question bank page', r.status === 200 && /Existing questions \(8\)/.test(r.text));
  const q1 = db.prepare('SELECT id FROM questions LIMIT 1').get().id;
  r = await admin.post(`/questions/${q1}/delete`, {}); check('Question cannot be deleted after exam started', db.prepare('SELECT COUNT(*) c FROM questions').get().c === 8 && /cannot/i.test(decodeURIComponent(r.loc || '')));
  r = await admin.post(`/applications/${aid}/status`, { status: 'Accepted' }); check('HR accepts a recommended candidate', db.prepare('SELECT status s FROM applications WHERE id=?').get(aid).s === 'Accepted');
  // Accepted is final: refused by the server itself (this request is what a crafted form or script would send).
  const statusLogs = () => db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action = 'STATUS_CHANGE'").get().c;
  const notesOf = () => db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = (SELECT user_id FROM applications WHERE id = ?)').get(aid).c;
  const logsBefore = statusLogs(), notesBefore = notesOf();
  r = await admin.post(`/applications/${aid}/status`, { status: 'Rejected' });
  check('Accepted is final: the server refuses to reject an Accepted application', db.prepare('SELECT status s FROM applications WHERE id=?').get(aid).s === 'Accepted' && r.status === 302 && /type=error/.test(r.loc || ''), r.loc || '');
  check('The refusal shows a clear error message', /accepted.*final.*cannot be rejected/i.test(decodeURIComponent(r.loc || '')), decodeURIComponent(r.loc || ''));
  check('A refused rejection writes no status-change log entry and sends no notification', statusLogs() === logsBefore && notesOf() === notesBefore);
  const slowAppId = db.prepare("SELECT id FROM applications WHERE user_id=(SELECT id FROM users WHERE email='slow@t.com')").get().id;
  r = await admin.post(`/applications/${slowAppId}/status`, { status: 'Rejected' });
  check('Rejecting an application that is not Accepted still works', db.prepare('SELECT status s FROM applications WHERE id=?').get(slowAppId).s === 'Rejected' && !/type=error/.test(r.loc || ''), r.loc || '');
  r = await admin.req('GET', '/admin/audit-logs?action=LOGIN'); check('Audit log filter by action', r.status === 200 && /LOGIN/.test(r.text));
  r = await admin.req('GET', `/vacancies/${vNA.id}/applications`); check('HR applicants-per-vacancy page', r.status === 200 && r.text.includes('good@t.com'));
  r = await mkVac({ title: 'Temp', department: 'X', category: 'non-academic' });
  const vTemp = db.prepare("SELECT id FROM vacancies WHERE title='Temp'").get().id;
  await admin.post(`/admin/vacancies/${vTemp}/close`, {}); const closed = db.prepare('SELECT closed_at c FROM vacancies WHERE id=?').get(vTemp).c;
  await admin.post(`/admin/vacancies/${vTemp}/reopen`, {}); const reopened = db.prepare('SELECT closed_at c FROM vacancies WHERE id=?').get(vTemp).c;
  check('HR closes and reopens a vacancy', !!closed && reopened === null);
  r = await good.req('GET', '/dashboard'); check('Applicant dashboard shows notifications', r.status === 200 && /Recent notifications/.test(r.text));
  tok = await good.token('/notifications');
  await good.req('POST', '/notifications/read-all', { form: { _csrf: tok } });
  check('Mark all notifications read', db.prepare("SELECT COUNT(*) c FROM notifications WHERE user_id=(SELECT id FROM users WHERE email='good@t.com') AND is_read=0").get().c === 0);

  // ---- 4.8 security
  const row = db.prepare("SELECT password FROM users WHERE email='good@t.com'").get(); check('Passwords stored as bcrypt hashes', /^\$2[aby]\$/.test(row.password));
  r = await admin.req('GET', '/admin/audit-logs'); check('Audit log page', r.status === 200);
  const acts = db.prepare('SELECT DISTINCT action FROM audit_logs').all().map((x) => x.action);
  console.log('   audit actions:', acts.join(', '));
  check('Audit logs: login, shortlist, score change', ['LOGIN', 'SHORTLIST_DECISION', 'SCORE_CHANGE'].every((a) => acts.includes(a)));
  r = await admin.req('GET', '/admin/sessions'); check('Login sessions tracked + viewable', r.status === 200 && db.prepare('SELECT COUNT(*) c FROM login_sessions').get().c > 0);
  const bad = new Client(base); r = await bad.login('good@t.com', 'wrong'); check('Bad password rejected', r.status === 400);
  r = await good.req('POST', '/vacancies/create', { form: { title: 'x' } }); check('POST without CSRF blocked', r.status === 403);

  // ---- weak-spot fixes: logout is a POST, dashboard JSON is script-safe, a failed CSRF check leaves no uploaded file
  const logoutCount = () => db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action = 'LOGOUT'").get().c;
  const lo = new Client(base);
  await lo.login('good@t.com', 'passw0rdX');
  r = await lo.req('GET', '/dashboard');
  check('Logout button is a POST form with a CSRF token and there is no /logout link', r.status === 200 && /<form action="\/logout" method="POST"[^>]*>\s*<input type="hidden" name="_csrf" value="[a-f0-9]+">/.test(r.text) && !/href="\/logout"/.test(r.text));
  const outBefore = logoutCount();
  r = await lo.req('GET', '/logout');
  const afterGet = await lo.req('GET', '/dashboard');
  check('GET /logout does not log the user out (session and audit log unchanged)', afterGet.status === 200 && logoutCount() === outBefore, `GET /logout -> ${r.status}, dashboard -> ${afterGet.status}`);
  r = await lo.req('POST', '/logout', { form: {} });
  check('POST /logout without the CSRF token is refused and the session stays', r.status === 403 && (await lo.req('GET', '/dashboard')).status === 200 && logoutCount() === outBefore, `status ${r.status}`);
  const lotoken = await lo.token('/dashboard');
  r = await lo.req('POST', '/logout', { form: { _csrf: lotoken } });
  check('POST /logout with the token logs out and redirects to /login', r.status === 302 && r.loc === '/login', `${r.status} ${r.loc}`);
  r = await lo.req('GET', '/dashboard');
  check('After POST /logout the session is gone (dashboard redirects to /login)', r.status === 302 && r.loc === '/login', `${r.status} ${r.loc}`);
  check('Logout still writes the LOGOUT audit entry and the logout time', logoutCount() === outBefore + 1 &&
    db.prepare("SELECT COUNT(*) c FROM login_sessions WHERE user_id = (SELECT id FROM users WHERE email = 'good@t.com') AND logout_at IS NOT NULL").get().c >= 1);

  const evil = '</script><script>alert(1)</script>';
  r = await mkVac({ title: evil, department: 'X', category: 'non-academic' });
  check('A vacancy title containing </script> can be created (it is only escaped on output)', r.status === 302, `status ${r.status}`);
  r = await admin.req('GET', '/dashboard');
  check('Dashboard chart data escapes < > & : the title cannot end the script', r.status === 200 && !r.text.includes('</script><script>alert(1)') &&
    r.text.includes('\\u003c/script\\u003e\\u003cscript\\u003ealert(1)\\u003c/script\\u003e'), `status ${r.status}`);
  check('Dashboard still has its three chart data variables', /var status = \{/.test(r.text) && /var perVacancy = \[/.test(r.text) && /var exam = \{/.test(r.text));

  await mkVac({ title: 'Orphan Check', department: 'X', category: 'non-academic' });
  const vOrph = db.prepare("SELECT id FROM vacancies WHERE title = 'Orphan Check'").get().id;
  const orph = await mkApplicant('orph');
  const uploadCount = () => fs.readdirSync(process.env.UPLOAD_DIR).length;
  const applyForm = () => {
    const fd = new FormData();
    Object.entries({ phone: '08012345678', address: '1 Kano Road', highest_qualification: 'Bachelor', experience_years: '2', qualifications_text: 'BSc CS', experience_text: 'x' }).forEach(([k, v]) => fd.append(k, v));
    fd.append('cv', pdf(), 'cv.pdf'); fd.append('supporting_docs', pdf(), 'docs.pdf');
    return fd;
  };
  const filesBefore = uploadCount();
  r = await orph.req('POST', `/vacancies/${vOrph}/apply?_csrf=wrong`, { multipart: applyForm() });
  check('Upload with a wrong CSRF token is refused (403), no application is created', r.status === 403 && !db.prepare('SELECT 1 FROM applications WHERE vacancy_id = ?').get(vOrph), `status ${r.status}`);
  check('... and the files Multer had saved are deleted (upload folder unchanged)', uploadCount() === filesBefore, `${filesBefore} -> ${uploadCount()}`);
  r = await orph.req('POST', `/vacancies/${vOrph}/apply`, { multipart: applyForm() });
  check('Upload with no CSRF token is refused (403) and leaves no file', r.status === 403 && uploadCount() === filesBefore, `status ${r.status}, ${filesBefore} -> ${uploadCount()}`);
  const orphPage = await orph.req('GET', `/vacancies/${vOrph}/apply`);
  const orphTok = /_csrf=([a-f0-9]+)/.exec(orphPage.text);
  r = await orph.req('POST', `/vacancies/${vOrph}/apply?_csrf=${orphTok && orphTok[1]}`, { multipart: applyForm() });
  check('Control: the same upload with the right token is accepted and its 2 files are kept', r.status === 302 && uploadCount() === filesBefore + 2 && !!db.prepare('SELECT 1 FROM applications WHERE vacancy_id = ?').get(vOrph), `status ${r.status}, ${filesBefore} -> ${uploadCount()}`);

  // ---- design-readability: vacancy cards, HR table, criteria table, stacked summary
  {
    const longDesc = 'Overview line one\n1. Mandatory Credentials\nBullet two\nBullet three\nBullet four <b>x</b>';
    r = await mkVac({ title: 'Card Test', department: 'IT', category: 'non-academic', min_qualification: 'Master', min_experience_years: 4, description: longDesc, requirements: 'Req line A\n2. Desirable Skills' });
    r = await good.req('GET', '/vacancies');
    const card = (r.text.split('Card Test')[1] || '').split('class="card"')[0];
    check('Vacancy card: minimum qualification and experience line', r.status === 200 && /Minimum qualification:\s*<strong>Master<\/strong>/.test(card) && /Minimum experience:\s*<strong>4 year\(s\)<\/strong>/.test(card));
    check('Vacancy card: <details> expander with the label', /<details class="vac-details">\s*<summary>Read full description and requirements<\/summary>/.test(card));
    check('Vacancy card: Description and Requirements are separate labelled blocks', /<h4>Description<\/h4>/.test(card) && /<h4>Requirements<\/h4>/.test(card) && card.indexOf('<h4>Description</h4>') < card.indexOf('<h4>Requirements</h4>'));
    check('Vacancy card: numbered lines are bold', /<strong>1\. Mandatory Credentials<\/strong>/.test(card) && /<strong>2\. Desirable Skills<\/strong>/.test(card));
    check('Vacancy card: line breaks kept and text is escaped', /Overview line one\n<strong>1\. Mandatory Credentials<\/strong>\nBullet two/.test(card) && card.includes('&lt;b&gt;x&lt;/b&gt;') && !card.includes('<b>x</b>'));
    check('Vacancy card: short preview block present', /<div class="vac-preview">/.test(card));
    check('Vacancy card: still has the old whole-description labels removed', !/<strong>Description:<\/strong>/.test(card));
    check('Vacancy card: no JavaScript needed for the expander (no onclick on the card)', !/onclick/.test(card));

    // HR applicants table (non-academic and academic versions)
    for (const [label, v, who] of [['non-academic', vNA, 'good'], ['academic', vAC, 'acad']]) {
      r = await admin.req('GET', `/vacancies/${v.id}/applications`);
      const appId = db.prepare("SELECT id FROM applications WHERE user_id=(SELECT id FROM users WHERE email=?)").get(`${who}@t.com`).id;
      check(`HR table (${label}): separate Application column header`, r.status === 200 && /<th class="col-application">Application<\/th>/.test(r.text));
      check(`HR table (${label}): "View application" button links to the details page`, new RegExp(`<a href="/admin/applications/${appId}" class="btn btn-primary btn-view">View application</a>`).test(r.text));
      check(`HR table (${label}): applicant name is a link too`, new RegExp(`<a href="/admin/applications/${appId}"><strong>${who}</strong></a>`).test(r.text));
      check(`HR table (${label}): the small "Details & documents" link is gone`, !/Details (&amp;|&) documents/.test(r.text));
      check(`HR table (${label}): number columns are centred (header and cells)`, /<th class="num">Exp\.<\/th>/.test(r.text) && /<td class="num">/.test(r.text));
    }
    r = await admin.req('GET', `/vacancies/${vNA.id}/applications`);
    check('HR table: Accept asks "Are you sure?" with the applicant name', /data-confirm="Accept good\? This is final\." onclick="return confirm\(this\.dataset\.confirm\)">Accept<\/button>/.test(r.text));
    check('HR table: Reject asks for confirmation', /data-confirm="Reject [^"]+" onclick="return confirm\(this\.dataset\.confirm\)">Reject<\/button>/.test(r.text) || !/>Reject<\/button>/.test(r.text));
    check('HR table: Decision column keeps only Accept/Reject (no view link inside it)', !/col-decision">[^]*?View application[^]*?<\/td>/.test((r.text.match(/<td class="col-decision">[^]*?<\/td>/g) || []).join('')));

    // criteria table
    const rowFor = (html, name) => (new RegExp(`<tr><td class="label-cell">${name}</td>[^]*?</tr>`).exec(html) || [''])[0];
    r = await admin.req('GET', `/admin/applications/${gid}`);
    check('Criteria table: header Criterion / Required / Applicant / Result', r.status === 200 && /<th>Criterion<\/th><th>Required<\/th><th>Applicant<\/th><th>Result<\/th>/.test(r.text));
    check('Criteria table: qualified applicant meets all three rows', ['Qualification', 'Experience', 'CV'].every((n) => /result-ok">&#10003; Meets/.test(rowFor(r.text, n))));
    const weakId = db.prepare("SELECT id FROM applications WHERE user_id=(SELECT id FROM users WHERE email='weak@t.com')").get().id;
    r = await admin.req('GET', `/admin/applications/${weakId}`);
    check('Criteria table: too little experience -> "Below minimum" (red, with words); qualification and CV still Meets', /result-bad">&#10007; Below minimum/.test(rowFor(r.text, 'Experience')) && /Meets/.test(rowFor(r.text, 'Qualification')) && /Meets/.test(rowFor(r.text, 'CV')));
    db.prepare('UPDATE applications SET cv_path = NULL WHERE id = ?').run(weakId);
    r = await admin.req('GET', `/admin/applications/${weakId}`);
    check('Criteria table: no CV -> "Missing"', /result-bad">&#10007; Missing/.test(rowFor(r.text, 'CV')) && /Not attached/.test(rowFor(r.text, 'CV')));
    db.prepare("UPDATE applications SET cv_path = 'x.pdf' WHERE id = ?").run(weakId);
    const awId = db.prepare("SELECT id FROM applications WHERE user_id=(SELECT id FROM users WHERE email='acadweak@t.com')").get().id;
    r = await admin.req('GET', `/admin/applications/${awId}`);
    check('Criteria table: qualification below the vacancy minimum -> "Below minimum"', /result-bad">&#10007; Below minimum/.test(rowFor(r.text, 'Qualification')));

    // stacked summary with counts
    r = await admin.req('GET', `/admin/applications/${aid}`);
    const wantHeadings = ['Academic qualifications (1)', 'Work experience (1)', 'Research publications (1)', 'Seminars & workshops (1)'];
    const missingHeadings = wantHeadings.filter((h) => !r.text.includes(`<h4>${h.replace('&', '&amp;')}</h4>`));
    check('Summary card: four stacked sections with counts (a single-box "P1\nP2" is stored as one entry)', missingHeadings.length === 0, missingHeadings.length ? `missing headings: ${missingHeadings.join(' | ')}` : '');
    check('Summary card: no longer laid out in columns', !/grid grid-2">\s*<div class="summary-section"/.test(r.text) && (r.text.match(/class="summary-section"/g) || []).length === 4);
    db.prepare("UPDATE applications SET seminars_text = '' WHERE id = ?").run(aid);
    r = await admin.req('GET', `/admin/applications/${aid}`);
    check('Summary card: empty list shows count 0 and "None provided by the applicant"', r.text.includes('<h4>Seminars &amp; workshops (0)</h4>') && /<p class="text-muted">None provided by the applicant<\/p>/.test(r.text));
    r = await admin.req('GET', `/admin/applications/${gid}`);
    check('Summary card (non-academic): only the two sections that apply', (r.text.match(/class="summary-section"/g) || []).length === 2 && !/Research publications/.test(r.text));
  }

  const failed = results.filter((x) => !x.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  await cleanup({ server, db, tmp }); // never throws; a cleanup problem only prints a warning
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('E2E crashed', e); process.exit(1); });
