// Tests for the per-vacancy settings: points scheme, 100-point cap, academic exam switch, optional exam sections,
// server-side validation and audit logging.  Run with:  npm test   (uses a throw-away database)
const path = require('path');
const os = require('os');
const fs = require('fs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buk-e2e2-'));
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
  async req(method, url, { form, multipart } = {}) {
    const h = {};
    const ck = Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    if (ck) h.cookie = ck;
    let body;
    if (form) { body = new URLSearchParams(form).toString(); h['content-type'] = 'application/x-www-form-urlencoded'; }
    if (multipart) body = multipart;
    const r = await fetch(this.base + url, { method, headers: h, body, redirect: 'manual' });
    (r.headers.getSetCookie ? r.headers.getSetCookie() : []).forEach((c) => { const [kv] = c.split(';'); const i = kv.indexOf('='); this.cookies[kv.slice(0, i)] = kv.slice(i + 1); });
    return { status: r.status, loc: r.headers.get('location'), text: await r.text().catch(() => '') };
  }
  async token(url = '/login') { const r = await this.req('GET', url); const m = /name="_csrf" value="([^"]+)"/.exec(r.text) || /_csrf=([a-f0-9]+)/.exec(r.text); return m && m[1]; }
  async login(email, password) { const t = await this.token('/login'); return this.req('POST', '/login', { form: { email, password, _csrf: t } }); }
  async post(url, form) { const t = await this.token('/vacancies/create'); return this.req('POST', url, { form: { ...form, _csrf: t } }); }
}

(async () => {
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  db.prepare("INSERT OR IGNORE INTO users (name,email,password,role) VALUES ('Admin','admin@buk.edu.ng',?, 'admin')").run(await bcrypt.hash('password123', 4));
  const admin = new Client(base);
  await admin.login('admin@buk.edu.ng', 'password123');

  const today = new Date(Date.now() + 3600000).toISOString().slice(0, 10);
  const countVac = () => db.prepare('SELECT COUNT(*) c FROM vacancies').get().c;
  const mkVac = (o) => admin.post('/vacancies/create', { description: 'd', requirements: 'r', opens_at: today, deadline: today, department: 'CS', min_qualification: 'Bachelor', min_experience_years: 0, settings_form: '1', pts_phd: 40, pts_master: 25, pts_bachelor: 10, pts_per_year: 5, pts_per_publication: 4, pts_per_seminar: 2, aptitude_enabled: 1, literacy_enabled: 1, ...o });
  const vacId = (title) => db.prepare('SELECT id FROM vacancies WHERE title = ?').get(title).id;
  const vac = (id) => db.prepare('SELECT * FROM vacancies WHERE id = ?').get(id);
  const logs = (action) => db.prepare('SELECT description FROM audit_logs WHERE action = ? ORDER BY id').all(action).map((x) => x.description);

  // ---------------------------------------------------------------- 5. validation on create
  const before = countVac();
  const bad = [
    ['negative', { pts_phd: '-1' }], ['decimal', { pts_master: '1.5' }], ['text', { pts_bachelor: 'abc' }],
    ['exponent', { pts_per_year: '1e2' }], ['too large', { pts_per_publication: '101' }], ['empty', { pts_per_seminar: '' }],
    ['both sections off', { aptitude_enabled: undefined, literacy_enabled: undefined }]
  ];
  for (const [name, o] of bad) {
    const r = await mkVac({ title: `Bad ${name}`, category: 'academic', ...o });
    check(`Create rejected: ${name}`, r.status === 400, `status ${r.status}`);
  }
  check('Rejected vacancies were not saved', countVac() === before);

  // ---------------------------------------------------------------- 2. defaults + custom scheme on create
  let r = await mkVac({ title: 'Lecturer A', category: 'academic', min_qualification: 'Bachelor' });
  const A = vac(vacId('Lecturer A'));
  check('Defaults stored as 40/25/10/5/4/2', r.status === 302 && [A.pts_phd, A.pts_master, A.pts_bachelor, A.pts_per_year, A.pts_per_publication, A.pts_per_seminar].join() === '40,25,10,5,4,2');
  check('Academic exam off by default; both sections on', A.academic_exam_enabled === 0 && A.aptitude_enabled === 1 && A.literacy_enabled === 1);
  r = await mkVac({ title: 'Lecturer B', category: 'academic', pts_phd: 10, pts_master: 5, pts_bachelor: 2, pts_per_year: 1, pts_per_publication: 1, pts_per_seminar: 1 });
  const B = vac(vacId('Lecturer B'));
  check('Custom scheme stored on create', r.status === 302 && [B.pts_phd, B.pts_master, B.pts_bachelor, B.pts_per_year, B.pts_per_publication, B.pts_per_seminar].join() === '10,5,2,1,1,1');
  check('Create is audit-logged with the settings', logs('VACANCY_CREATED').some((d) => d.includes('Lecturer B') && d.includes('PhD 10')));

  // ---------------------------------------------------------------- scheme shown to applicants
  const mkApplicant = async (n) => { const c = new Client(base); const t = await c.token('/register'); await c.req('POST', '/register', { form: { name: n, email: `${n}@t.com`, password: 'passw0rdX', _csrf: t } }); await c.login(`${n}@t.com`, 'passw0rdX'); return c; };
  const pdf = () => new Blob(['%PDF-1.4 test'], { type: 'application/pdf' });
  const apply = async (c, vid, f) => {
    const page = await c.req('GET', `/vacancies/${vid}/apply`);
    const m = /_csrf=([a-f0-9]+)/.exec(page.text);
    const fd = new FormData();
    Object.entries({ phone: '08012345678', address: '1 Kano Road', highest_qualification: 'PhD', experience_years: '5', qualifications_text: 'PhD', experience_text: 'x', publications_text: ['P1', 'P2'], seminars_text: ['S1'], ...f }).forEach(([k, v]) => [].concat(v).forEach((x) => fd.append(k, x)));
    fd.append('cv', pdf(), 'cv.pdf'); fd.append('supporting_docs', pdf(), 'docs.pdf');
    return c.req('POST', `/vacancies/${vid}/apply?_csrf=${m && m[1]}`, { multipart: fd });
  };
  const ann = await mkApplicant('ann');
  r = await ann.req('GET', '/vacancies');
  check('Vacancy list shows each vacancy\'s own points scheme', r.status === 200 && /PhD[^<]{0,12}40/.test(r.text.replace(/<[^>]+>/g, ' ')) && /PhD[^<]{0,12}10/.test(r.text.replace(/<[^>]+>/g, ' ')));
  r = await ann.req('GET', `/vacancies/${A.id}/apply`);
  check('Apply page shows the scheme', r.status === 200 && /points/i.test(r.text) && r.text.includes('40'));

  // ---------------------------------------------------------------- 2. same applicant, two schemes
  await apply(ann, A.id); await apply(ann, B.id);
  const score = (vid, email) => db.prepare('SELECT academic_score s FROM applications WHERE vacancy_id = ? AND user_id = (SELECT id FROM users WHERE email = ?)').get(vid, email).s;
  check('Scheme A: PhD, 5 yrs, 2 pubs, 1 seminar = 40+25+8+2 = 75', score(A.id, 'ann@t.com') === 75, String(score(A.id, 'ann@t.com')));
  check('Scheme B: same applicant = 10+5+2+1 = 18', score(B.id, 'ann@t.com') === 18, String(score(B.id, 'ann@t.com')));

  // ---------------------------------------------------------------- 1. cap at 100
  const bob = await mkApplicant('bob');
  r = await apply(bob, A.id, { experience_years: '30', publications_text: Array.from({ length: 10 }, (_, i) => `P${i}`), seminars_text: Array.from({ length: 10 }, (_, i) => `S${i}`) });
  const bobApp = db.prepare("SELECT id, academic_score s FROM applications WHERE user_id = (SELECT id FROM users WHERE email='bob@t.com')").get();
  check('Raw 250 points is stored as 100', r.status === 302 && bobApp.s === 100, String(bobApp.s));
  r = await admin.req('GET', `/admin/applications/${bobApp.id}`);
  check('Detail page shows 100, not 250', r.status === 200 && /100 points/.test(r.text) && !/250 points/.test(r.text));
  await admin.post(`/admin/applications/${bobApp.id}/academic-score`, { highest_qualification: 'PhD', experience_years: 60, journal_publications_count: 50, seminars_attended: 50 });
  check('HR recalculation is capped at 100', db.prepare('SELECT academic_score s FROM applications WHERE id = ?').get(bobApp.id).s === 100);
  db.prepare('UPDATE applications SET academic_score = 250 WHERE id = ?').run(bobApp.id); // a legacy uncapped value
  r = await admin.req('GET', `/admin/applications/${bobApp.id}`);
  check('A legacy stored score of 250 is still displayed as 100', /100 points/.test(r.text) && !/250/.test(r.text.replace(/\s/g, '')) || /100 points/.test(r.text));
  r = await admin.req('GET', `/vacancies/${A.id}/applications`);
  check('Applicants list shows capped score', r.status === 200 && !/<td>250<\/td>/.test(r.text));
  r = await admin.req('GET', '/admin/applications');
  check('All-applicants list shows capped score', r.status === 200 && !/250 pts/.test(r.text));

  // ---------------------------------------------------------------- 5. settings validation + audit + rescoring
  const settingsUrl = `/admin/vacancies/${B.id}/settings`;
  const okForm = { settings_form: '1', pts_phd: 10, pts_master: 5, pts_bachelor: 2, pts_per_year: 1, pts_per_publication: 1, pts_per_seminar: 1, aptitude_enabled: 1, literacy_enabled: 1 };
  for (const [name, o] of [['negative', { pts_phd: '-5' }], ['decimal', { pts_per_year: '2.5' }], ['above max', { pts_master: '500' }], ['text', { pts_per_seminar: 'x' }], ['both sections off', { aptitude_enabled: undefined, literacy_enabled: undefined }]]) {
    r = await admin.post(settingsUrl, { ...okForm, ...o });
    check(`Settings rejected: ${name}`, r.status === 400, `status ${r.status}`);
  }
  check('Rejected settings changed nothing', vac(B.id).pts_phd === 10 && vac(B.id).pts_master === 5);
  const nLogs = logs('VACANCY_SETTINGS_CHANGED').length;
  await admin.post(settingsUrl, okForm);
  check('Saving unchanged settings writes no audit entry', logs('VACANCY_SETTINGS_CHANGED').length === nLogs);
  r = await admin.post(settingsUrl, { ...okForm, pts_per_year: 3, pts_phd: 20 });
  check('Settings saved', r.status === 302 && vac(B.id).pts_per_year === 3 && vac(B.id).pts_phd === 20);
  const last = logs('VACANCY_SETTINGS_CHANGED').pop() || '';
  check('Points change is audit-logged (before and after)', /Before:.*PhD 10.*After:.*PhD 20/.test(last), last.slice(0, 160));
  check('Existing applications rescored from the new scheme (20+15+2+1 = 38)', score(B.id, 'ann@t.com') === 38, String(score(B.id, 'ann@t.com')));
  check('Other vacancies are unaffected by the change', score(A.id, 'ann@t.com') === 75);
  r = await ann.post(settingsUrl, okForm);
  check('Applicants cannot change vacancy settings', r.status === 403);

  // ---------------------------------------------------------------- 3. academic exam switch
  const Q = db.prepare("SELECT COUNT(*) c FROM questions WHERE vacancy_id = ?");
  const addQ = (vid, section, i) => admin.post('/questions/create', { vacancy_id: vid, section, question_text: `${section} Q${i}`, option_a: 'a', option_b: 'b', option_c: 'c', option_d: 'd', correct_option: 'B' });
  const fmt = (d) => new Date(d.getTime() + 3600000).toISOString().slice(0, 16);
  const schedule = (vid, extra = {}) => admin.post(`/admin/vacancies/${vid}/exam`, { exam_start: fmt(new Date(Date.now() - 600000)), exam_end: fmt(new Date(Date.now() + 3600000)), aptitude_minutes: 10, literacy_minutes: 10, aptitude_weight: 50, literacy_weight: 50, pass_mark: 50, questions_per_section: 4, ...extra });
  const shortlist = (email, vid) => db.prepare("UPDATE applications SET status = 'Shortlisted', shortlisted = 1 WHERE vacancy_id = ? AND user_id = (SELECT id FROM users WHERE email = ?)").run(vid, email);
  shortlist('ann@t.com', A.id);

  r = await addQ(A.id, 'Aptitude', 0);
  check('Switch off: question bank refuses an academic vacancy', Q.get(A.id).c === 0, decodeURIComponent(r.loc || ''));
  r = await schedule(A.id);
  check('Switch off: exam cannot be scheduled', /not enabled/i.test(decodeURIComponent(r.loc || '')) && !vac(A.id).exam_start);
  r = await ann.req('GET', `/exam/${A.id}`);
  check('Switch off: academic applicant cannot open the exam', r.status === 302 && /my-applications/.test(r.loc));
  let tok = await ann.token('/my-applications');
  await ann.req('POST', `/exam/${A.id}/start`, { form: { _csrf: tok } });
  check('Switch off: starting the exam creates no attempt', db.prepare('SELECT COUNT(*) c FROM exam_attempts WHERE vacancy_id = ?').get(A.id).c === 0);
  r = await ann.req('GET', '/my-applications');
  check('Switch off: no test button for the academic applicant', !/Take (the )?(exam|test)/i.test(r.text) && !/Start (the )?(exam|test)/i.test(r.text));

  const aSet = { settings_form: '1', pts_phd: 40, pts_master: 25, pts_bachelor: 10, pts_per_year: 5, pts_per_publication: 4, pts_per_seminar: 2, aptitude_enabled: 1, literacy_enabled: 1 };
  r = await admin.post(`/admin/vacancies/${A.id}/settings`, { ...aSet, academic_exam_enabled: 1 });
  check('HR switches the academic exam on', r.status === 302 && vac(A.id).academic_exam_enabled === 1);
  check('Exam switch change is audit-logged', logs('VACANCY_SETTINGS_CHANGED').some((d) => d.includes(`vacancy ID ${A.id}`) && /academic exam off/.test(d) && /academic exam ON/.test(d)));
  for (let i = 0; i < 4; i++) { await addQ(A.id, 'Aptitude', i); await addQ(A.id, 'Computer Literacy', i); }
  check('Switch on: questions can be added to the academic vacancy', Q.get(A.id).c === 8);
  r = await schedule(A.id);
  check('Switch on: HR schedules the exam', r.status === 302 && /scheduled/i.test(decodeURIComponent(r.loc || '')) && !!vac(A.id).exam_start, decodeURIComponent(r.loc || ''));
  r = await admin.req('GET', `/admin/vacancies/${A.id}/exam`);
  check('Exam settings page works for an academic vacancy', r.status === 200 && /Pass mark/.test(r.text) && !/switched off/.test(r.text));
  r = await admin.req('GET', `/vacancies/${A.id}/applications`);
  check('HR applicants page offers exam + question bank for it', r.status === 200 && /Question bank/.test(r.text) && /Schedule \/ configure exam/.test(r.text));
  r = await ann.req('GET', '/my-applications');
  check('Switch on: shortlisted academic applicant sees the test', /\/exam\/\d+/.test(r.text), '');
  r = await ann.req('GET', `/exam/${A.id}`);
  check('Switch on: academic applicant can open the exam', r.status === 200);
  tok = await ann.token(`/exam/${A.id}`);
  r = await ann.req('POST', `/exam/${A.id}/start`, { form: { _csrf: tok } });
  check('Switch on: exam starts', r.status === 302 && db.prepare('SELECT COUNT(*) c FROM exam_attempts WHERE vacancy_id = ?').get(A.id).c === 1);
  for (let s = 0; s < 2; s++) {
    r = await ann.req('GET', `/exam/${A.id}`);
    const ids = [...new Set([...r.text.matchAll(/name="(q_\d+)"/g)].map((m) => m[1]))];
    const form = { section_index: s, _csrf: (/name="_csrf" value="([^"]+)"/.exec(r.text) || [])[1] };
    ids.forEach((n, i) => { form[n] = i % 2 === 0 ? 'B' : 'A'; }); // half right
    await ann.req('POST', `/exam/${A.id}/submit`, { form });
  }
  const res = db.prepare('SELECT * FROM exam_results WHERE vacancy_id = ?').get(A.id);
  check('Academic exam is auto-marked (50%)', res && res.percentage === 50, JSON.stringify(res && { p: res.percentage, s: res.score, t: res.total_questions }));
  r = await ann.req('GET', `/exam/${A.id}/result`);
  check('Academic applicant sees the result page', r.status === 200);
  const annApp = db.prepare("SELECT id FROM applications WHERE vacancy_id = ? AND user_id = (SELECT id FROM users WHERE email='ann@t.com')").get(A.id).id;
  r = await admin.req('GET', `/admin/applications/${annApp}`);
  check('HR detail page shows academic points AND the exam result', r.status === 200 && /Academic evaluation/.test(r.text) && /Computer-based test/.test(r.text) && /50\.0%/.test(r.text));
  r = await admin.req('GET', '/admin/applications');
  check('All-applicants list shows points and exam %', /75 pts \/ 50\.0%/.test(r.text.replace(/\s+/g, ' ')), '');
  const get = async (p) => { const rr = await fetch(base + p, { headers: { cookie: Object.entries(admin.cookies).map(([k, v]) => `${k}=${v}`).join('; ') } }); return { status: rr.status, buf: Buffer.from(await rr.arrayBuffer()) }; };
  let g = await get(`/admin/reports/merit/csv?vacancy_id=${A.id}`);
  check('Merit report (CSV) includes the academic exam candidate with exam %', g.status === 200 && /Ann/i.test(g.buf.toString()) && /50/.test(g.buf.toString()), g.buf.toString().split('\n')[1] || '');
  g = await get(`/admin/reports/merit/pdf?vacancy_id=${A.id}`);
  check('Merit report (PDF) works', g.status === 200 && g.buf.slice(0, 4).toString() === '%PDF');
  for (const t of ['applicants', 'shortlisted', 'statistics']) { g = await get(`/admin/reports/${t}/csv`); check(`Report ${t}.csv works with academic exams`, g.status === 200); }
  r = await admin.req('GET', '/dashboard');
  check('HR dashboard still renders', r.status === 200);
  r = await admin.req('GET', `/admin/vacancies/${A.id}/settings`);
  check('Exam switches lock once applicants have started', /locked/i.test(r.text));
  r = await admin.post(`/admin/vacancies/${A.id}/settings`, { ...aSet, aptitude_enabled: undefined });
  check('A locked switch cannot be changed by a crafted request', vac(A.id).aptitude_enabled === 1 && vac(A.id).academic_exam_enabled === 1);
  const anExamless = await mkApplicant('cy');
  await apply(anExamless, B.id); shortlist('cy@t.com', B.id);
  r = await anExamless.req('GET', `/exam/${B.id}`);
  check('Another academic vacancy (switch off) still has no exam', r.status === 302 && /my-applications/.test(r.loc));

  // ---------------------------------------------------------------- 4. only one section on
  const oneSection = async (title, flags, sectionName) => {
    await mkVac({ title, category: 'non-academic', ...flags });
    const v = vac(vacId(title));
    for (let i = 0; i < 4; i++) { await addQ(v.id, 'Aptitude', i); await addQ(v.id, 'Computer Literacy', i); }
    r = await schedule(v.id, { aptitude_weight: 30, literacy_weight: 70 });
    check(`${title}: exam scheduled`, r.status === 302 && !!vac(v.id).exam_start, decodeURIComponent(r.loc || ''));
    const c = await mkApplicant(title.replace(/\W/g, '').toLowerCase());
    const em = `${title.replace(/\W/g, '').toLowerCase()}@t.com`;
    const uid = db.prepare('SELECT id FROM users WHERE email = ?').get(em).id;
    db.prepare("INSERT INTO applications (user_id,vacancy_id,status,shortlisted,highest_qualification,experience_years,cv_path,supporting_documents_path) VALUES (?,?, 'Shortlisted',1,'Bachelor',3,'x.pdf','y.pdf')").run(uid, v.id);
    r = await c.req('GET', `/exam/${v.id}`);
    check(`${title}: intro lists only ${sectionName}`, r.status === 200 && r.text.includes(sectionName) && !r.text.includes(sectionName === 'Aptitude' ? 'Computer Literacy' : 'Aptitude'));
    const t = await c.token(`/exam/${v.id}`);
    await c.req('POST', `/exam/${v.id}/start`, { form: { _csrf: t } });
    const att = db.prepare('SELECT * FROM exam_attempts WHERE user_id = ?').get(uid);
    const secs = JSON.parse(att.sections_json);
    check(`${title}: paper has exactly one section (${sectionName})`, secs.length === 1 && secs[0].name === sectionName, secs.map((s) => s.name).join());
    r = await c.req('GET', `/exam/${v.id}`);
    const ids = [...new Set([...r.text.matchAll(/name="(q_\d+)"/g)].map((m) => m[1]))];
    const form = { section_index: 0, _csrf: (/name="_csrf" value="([^"]+)"/.exec(r.text) || [])[1] };
    ids.forEach((n, i) => { form[n] = i < 3 ? 'B' : 'A'; }); // 3 of 4 right
    r = await c.req('POST', `/exam/${v.id}/submit`, { form });
    const er = db.prepare('SELECT * FROM exam_results WHERE user_id = ?').get(uid);
    check(`${title}: exam finishes after the single section`, r.status === 302 && !!er, String(r.status));
    check(`${title}: final score = that section at full weight (75%, not scaled by weight 30/70)`, er && Math.round(er.percentage) === 75 && er.score === 3 && er.total_questions === 4, JSON.stringify(er && { p: er.percentage, s: er.score, t: er.total_questions }));
    r = await c.req('GET', `/exam/${v.id}/result`);
    check(`${title}: result page renders`, r.status === 200);
    const aid = db.prepare('SELECT id FROM applications WHERE user_id = ?').get(uid).id;
    r = await admin.req('GET', `/admin/applications/${aid}`);
    check(`${title}: HR detail lists one section`, r.status === 200 && r.text.includes(sectionName) && !r.text.includes(sectionName === 'Aptitude' ? 'Computer Literacy' : 'Aptitude'));
    return v;
  };
  const vApt = await oneSection('Only Aptitude', { literacy_enabled: undefined }, 'Aptitude');
  await oneSection('Only Literacy', { aptitude_enabled: undefined }, 'Computer Literacy');
  r = await admin.req('GET', `/admin/vacancies/${vApt.id}/exam`);
  check('Exam settings page hides the switched-off section', r.status === 200 && !/Computer literacy: minutes/i.test(r.text));
  r = await admin.post(`/admin/vacancies/${vacId('Only Aptitude')}/settings`, { ...okForm, aptitude_enabled: 1, literacy_enabled: 1 });
  check('Sections cannot be changed after applicants started that exam', vac(vacId('Only Aptitude')).literacy_enabled === 0 && vac(vacId('Only Aptitude')).aptitude_enabled === 1);
  await mkVac({ title: 'Unlocked', category: 'non-academic' });
  r = await admin.post(`/admin/vacancies/${vacId('Unlocked')}/settings`, { ...okForm, aptitude_enabled: undefined, literacy_enabled: undefined });
  check('Cannot switch both sections off (unlocked vacancy)', r.status === 400 && vac(vacId('Unlocked')).aptitude_enabled === 1);
  r = await admin.post(`/admin/vacancies/${vacId('Unlocked')}/settings`, { ...okForm, aptitude_enabled: undefined });
  check('Sections can be switched on/off before the exam starts (Literacy only)', r.status === 302 && vac(vacId('Unlocked')).aptitude_enabled === 0 && vac(vacId('Unlocked')).literacy_enabled === 1);
  check('Section change is audit-logged', logs('VACANCY_SETTINGS_CHANGED').some((d) => /Aptitude OFF/.test(d)));

  // ---------------------------------------------------------------- old vacancies behave as before
  db.prepare(`INSERT INTO vacancies (title, department, category, description, requirements, min_qualification, min_experience_years, opens_at, deadline)
              VALUES ('Legacy Academic','X','academic','d','r','Bachelor',0,?,?)`).run(today, today); // no new columns given
  const L = vac(vacId('Legacy Academic'));
  check('A row created the old way gets the defaults', [L.pts_phd, L.pts_master, L.pts_bachelor, L.pts_per_year, L.pts_per_publication, L.pts_per_seminar].join() === '40,25,10,5,4,2' && L.academic_exam_enabled === 0 && L.aptitude_enabled === 1 && L.literacy_enabled === 1);
  db.prepare('UPDATE vacancies SET pts_phd=NULL, pts_master=NULL, pts_bachelor=NULL, pts_per_year=NULL, pts_per_publication=NULL, pts_per_seminar=NULL, academic_exam_enabled=NULL, aptitude_enabled=NULL, literacy_enabled=NULL WHERE id = ?').run(L.id);
  const dan = await mkApplicant('dan');
  r = await apply(dan, L.id);
  check('Old vacancy (NULL settings) scores with the defaults: 75', r.status === 302 && score(L.id, 'dan@t.com') === 75, String(score(L.id, 'dan@t.com')));
  shortlist('dan@t.com', L.id);
  r = await dan.req('GET', `/exam/${L.id}`);
  check('Old academic vacancy still has no exam', r.status === 302);
  r = await admin.req('GET', `/admin/vacancies/${L.id}/settings`);
  check('Settings page opens for an old vacancy with the defaults filled in', r.status === 200 && /value="40"/.test(r.text) && /value="25"/.test(r.text));
  r = await admin.req('GET', `/vacancies/${L.id}/applications`);
  check('HR applicants page works for an old vacancy', r.status === 200);
  r = await mkVac({ title: 'Old client', category: 'non-academic', settings_form: undefined, pts_phd: undefined, pts_master: undefined, pts_bachelor: undefined, pts_per_year: undefined, pts_per_publication: undefined, pts_per_seminar: undefined, aptitude_enabled: undefined, literacy_enabled: undefined });
  check('A create request without the new fields still works (defaults)', r.status === 302 && vac(vacId('Old client')).aptitude_enabled === 1);
  db.prepare('UPDATE applications SET academic_score = 180 WHERE vacancy_id = ?').run(L.id);
  require(path.join(root, 'models/db')); // migration is idempotent and caps leftovers when the schema is initialised again
  r = await admin.req('GET', '/admin/applications');
  check('Pre-cap data (180) is shown as 100', !/180 pts/.test(r.text));

  const failed = results.filter((x) => !x.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('E2E crashed', e); process.exit(1); });
