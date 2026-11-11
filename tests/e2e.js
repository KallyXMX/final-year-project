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

  const failed = results.filter((x) => !x.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('E2E crashed', e); process.exit(1); });
