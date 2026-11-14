// Tests for the combined recruitment score: category maxima, capped academic parts, personal data + interview scores
// (two decimals), combined total, merit-list ranking and tie-breaks, positions ("slots"), and unchanged legacy / non-academic behaviour.
// Run with:  npm test   (uses a throw-away database)
const path = require('path');
const os = require('os');
const fs = require('fs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buk-e2e3-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');

const root = path.join(__dirname, '..');
const bcrypt = require('bcrypt');
const db = require(path.join(root, 'models/db'));
const http = require('http');
const app = require(path.join(root, 'app'));
const { academicBreakdown, schemeOf } = require(path.join(root, 'utils/qualifications'));

const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`); };

class Client {
  constructor(base) { this.base = base; this.cookies = {}; }
  async req(method, url, { form, multipart } = {}) {
    const h = {};
    const ck = Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    if (ck) h.cookie = ck;
    let body;
    if (form) { body = new URLSearchParams(Object.entries(form).filter(([, v]) => v !== undefined)).toString(); h['content-type'] = 'application/x-www-form-urlencoded'; }
    if (multipart) body = multipart;
    const r = await fetch(this.base + url, { method, headers: h, body, redirect: 'manual' });
    (r.headers.getSetCookie ? r.headers.getSetCookie() : []).forEach((c) => { const [kv] = c.split(';'); const i = kv.indexOf('='); this.cookies[kv.slice(0, i)] = kv.slice(i + 1); });
    return { status: r.status, loc: r.headers.get('location') || '', text: await r.text().catch(() => '') };
  }
  async token(url = '/login') { const r = await this.req('GET', url); const m = /name="_csrf" value="([^"]+)"/.exec(r.text) || /_csrf=([a-f0-9]+)/.exec(r.text); return m && m[1]; }
  async login(email, password) { const t = await this.token('/login'); return this.req('POST', '/login', { form: { email, password, _csrf: t } }); }
  async post(url, form) { const t = await this.token('/vacancies/create'); return this.req('POST', url, { form: { ...form, _csrf: t } }); }
}

(async () => {
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const hash = await bcrypt.hash('password123', 4);
  db.prepare("INSERT OR IGNORE INTO users (name,email,password,role) VALUES ('Admin','admin@buk.edu.ng',?, 'admin')").run(hash);
  const admin = new Client(base);
  await admin.login('admin@buk.edu.ng', 'password123');

  const today = new Date(Date.now() + 3600000).toISOString().slice(0, 10);
  const vac = (id) => db.prepare('SELECT * FROM vacancies WHERE id = ?').get(id);
  const vacId = (title) => db.prepare('SELECT id FROM vacancies WHERE title = ?').get(title).id;
  const countVac = () => db.prepare('SELECT COUNT(*) c FROM vacancies').get().c;
  const logs = (action) => db.prepare('SELECT description FROM audit_logs WHERE action = ? ORDER BY id').all(action).map((x) => x.description);
  const MAXKEYS = ['max_qualification', 'max_experience', 'max_publications', 'max_personal_data', 'max_interview'];
  const maxOf = (v) => MAXKEYS.map((k) => v[k]).join();
  const M = { max_qualification: 30, max_experience: 20, max_publications: 20, max_personal_data: 10, max_interview: 20 };
  const pts = { pts_phd: 40, pts_master: 25, pts_bachelor: 10, pts_per_year: 5, pts_per_publication: 4, pts_per_seminar: 2 };
  const mkVac = (o) => admin.post('/vacancies/create', { description: 'd', requirements: 'r', opens_at: today, deadline: today, department: 'CS', min_qualification: 'Bachelor', min_experience_years: 0, settings_form: '1', ...pts, ...M, aptitude_enabled: 1, literacy_enabled: 1, ...o });
  const settingsOf = (id) => `/admin/vacancies/${id}/settings`;
  const okSettings = { settings_form: '1', ...pts, ...M, aptitude_enabled: 1, literacy_enabled: 1 };
  const csv = async (vid) => {
    const rr = await fetch(`${base}/admin/reports/merit/csv?vacancy_id=${vid}`, { headers: { cookie: Object.entries(admin.cookies).map(([k, v]) => `${k}=${v}`).join('; ') } });
    const lines = (await rr.text()).trim().split('\n');
    const head = lines[0].split(',');
    return { status: rr.status, head, rows: lines.slice(1).map((l) => Object.fromEntries(l.split(',').map((c, i) => [head[i], c]))) };
  };
  let n = 0;
  // Insert a shortlisted application directly (figures, scores and optional exam result).
  const addApp = (vid, name, o = {}) => {
    n++;
    const uid = db.prepare("INSERT INTO users (name,email,password,role) VALUES (?,?,?, 'applicant')").run(name, `u${n}@t.com`, hash).lastInsertRowid;
    const v = vac(vid);
    const f = { highest_qualification: o.q || 'Bachelor', experience_years: o.years || 0, journal_publications_count: o.pubs || 0, seminars_attended: o.sems || 0 };
    const score = v.category === 'academic' ? academicBreakdown(f, schemeOf(v)).total : 0;
    const aid = db.prepare(`INSERT INTO applications (user_id,vacancy_id,status,shortlisted,highest_qualification,experience_years,journal_publications_count,seminars_attended,
      academic_score,personal_data_score,interview_score,exam_completed,cv_path,supporting_documents_path) VALUES (?,?,?,1,?,?,?,?,?,?,?,?, 'x.pdf','y.pdf')`)
      .run(uid, vid, o.status || 'Shortlisted', f.highest_qualification, f.experience_years, f.journal_publications_count, f.seminars_attended, score,
        o.personal === undefined ? null : o.personal, o.interview === undefined ? null : o.interview, o.exam === undefined ? 0 : 1).lastInsertRowid;
    if (o.exam !== undefined) db.prepare('INSERT INTO exam_results (user_id,vacancy_id,score,total_questions,percentage,passed) VALUES (?,?,?,?,?,?)').run(uid, vid, o.exam, 100, o.exam, o.exam >= 50 ? 1 : 0);
    return aid;
  };
  const interview = (aid, form) => admin.post(`/admin/applications/${aid}/interview`, { final_decision: '', interviewer_remarks: 'ok', ...form });
  const row = (aid) => db.prepare('SELECT * FROM applications WHERE id = ?').get(aid);
  const isErr = (r) => r.status === 302 && /type=error/.test(r.loc);

  // ================================================================ 1. maxima: validation, defaults, NULL = legacy
  let r = await admin.req('GET', '/vacancies/create');
  check('New-vacancy form is pre-filled with 30 / 20 / 20 / 10 / 20', MAXKEYS.every((k, i) => new RegExp(`name="${k}"[^>]*value="${[30, 20, 20, 10, 20][i]}"`).test(r.text)));
  const before = countVac();
  const sumBad = [['sum 99', { max_interview: 19 }], ['sum 101', { max_interview: 21 }], ['sum 0', { max_qualification: 0, max_experience: 0, max_publications: 0, max_personal_data: 0, max_interview: 0 }]];
  for (const [name, o] of sumBad) { r = await mkVac({ title: `Bad ${name}`, category: 'academic', ...o }); check(`Maxima rejected: ${name}`, r.status === 400, `status ${r.status}`); }
  for (const k of MAXKEYS) {
    for (const [name, val] of [['negative', '-1'], ['decimal', '1.5'], ['text', 'abc'], ['above 100', '101'], ['exponent', '1e1']]) {
      r = await mkVac({ title: `Bad ${k} ${name}`, category: 'academic', [k]: val });
      check(`Maxima rejected: ${k} ${name}`, r.status === 400, `status ${r.status}`);
    }
    r = await mkVac({ title: `Bad ${k} blank`, category: 'academic', [k]: '' });
    check(`Maxima rejected: only ${k} left empty`, r.status === 400, `status ${r.status}`);
  }
  check('No rejected request saved a vacancy', countVac() === before);
  r = await mkVac({ title: 'Max Default', category: 'academic' });
  check('Valid maxima 30/20/20/10/20 saved', r.status === 302 && maxOf(vac(vacId('Max Default'))) === '30,20,20,10,20');
  r = await mkVac({ title: 'Max Custom', category: 'academic', max_qualification: 40, max_experience: 10, max_publications: 10, max_personal_data: 5, max_interview: 35 });
  check('Another valid split (40/10/10/5/35 = 100) saved', r.status === 302 && maxOf(vac(vacId('Max Custom'))) === '40,10,10,5,35');
  r = await mkVac({ title: 'Max Legacy Form', category: 'academic', max_qualification: '', max_experience: '', max_publications: '', max_personal_data: '', max_interview: '' });
  check('All five empty = legacy scoring (all NULL)', r.status === 302 && vac(vacId('Max Legacy Form')).max_qualification === null && vac(vacId('Max Legacy Form')).max_interview === null);
  r = await mkVac({ title: 'Non Acad', category: 'non-academic' });
  check('Non-academic vacancy keeps NULL maxima (ignored)', r.status === 302 && vac(vacId('Non Acad')).max_qualification === null);
  r = await mkVac({ title: 'Non Acad Junk', category: 'non-academic', max_qualification: 1 });
  check('Maxima are not validated or stored for non-academic vacancies', r.status === 302 && vac(vacId('Non Acad Junk')).max_interview === null);
  r = await admin.post('/vacancies/create', { title: 'Old Client', department: 'CS', category: 'academic', description: 'd', requirements: 'r', min_qualification: 'Bachelor', min_experience_years: 0, opens_at: today, deadline: today });
  check('A request without the form fields keeps legacy scoring (NULL maxima, no slots)', r.status === 302 && vac(vacId('Old Client')).max_qualification === null && vac(vacId('Old Client')).slots === null);
  check('Maxima are written to the audit log on create', logs('VACANCY_CREATED').some((d) => d.includes('Max Default') && /Qualification 30, Experience 20, Publications 20, Personal data 10, Interview 20/.test(d)));
  db.prepare("INSERT INTO vacancies (title, department, category, description, requirements, min_qualification, min_experience_years, opens_at, deadline) VALUES ('Old Row','X','academic','d','r','Bachelor',0,?,?)").run(today, today);
  const oldRow = vac(vacId('Old Row'));
  check('A vacancy row made the old way has NULL maxima and slots', MAXKEYS.every((k) => oldRow[k] === null) && oldRow.slots === null);
  check('Applications have a personal_data_score column', db.prepare('PRAGMA table_info(applications)').all().some((c) => c.name === 'personal_data_score'));

  // ================================================================ 2. capped academic parts
  const A = vacId('Max Default'), LEG = vacId('Max Legacy Form');
  db.prepare('UPDATE vacancies SET deadline = ? WHERE id IN (?,?)').run(today, A, LEG); // stays open today
  const mkApplicant = async (nm) => { const c = new Client(base); const t = await c.token('/register'); await c.req('POST', '/register', { form: { name: nm, email: `${nm}@a.com`, password: 'passw0rdX', _csrf: t } }); await c.login(`${nm}@a.com`, 'passw0rdX'); return c; };
  const apply = async (c, vid, f) => {
    const page = await c.req('GET', `/vacancies/${vid}/apply`);
    const m = /_csrf=([a-f0-9]+)/.exec(page.text);
    const fd = new FormData();
    Object.entries({ phone: '08012345678', address: '1 Kano Road', highest_qualification: 'PhD', experience_years: '3', qualifications_text: 'PhD', experience_text: 'x', publications_text: ['P1', 'P2'], seminars_text: ['S1', 'S2', 'S3'], ...f }).forEach(([k, v]) => [].concat(v).forEach((x) => fd.append(k, x)));
    fd.append('cv', new Blob(['%PDF-1.4 t'], { type: 'application/pdf' }), 'cv.pdf'); fd.append('supporting_docs', new Blob(['%PDF-1.4 t'], { type: 'application/pdf' }), 'd.pdf');
    return c.req('POST', `/vacancies/${vid}/apply?_csrf=${m && m[1]}`, { multipart: fd });
  };
  const scoreOf = (vid, nm) => db.prepare('SELECT academic_score s FROM applications WHERE vacancy_id = ? AND user_id = (SELECT id FROM users WHERE email = ?)').get(vid, `${nm}@a.com`).s;
  const ann = await mkApplicant('ann');
  r = await ann.req('GET', `/vacancies/${A}/apply`);
  check('Applicants see the category maxima on the apply page', /out of\s*<strong>100/.test(r.text) && /personal data <strong>10/.test(r.text) && /physical interview <strong>20/.test(r.text));
  await apply(ann, A); await apply(ann, LEG);
  check('Qualification is capped: PhD 40 points counts as 30', academicBreakdown({ highest_qualification: 'PhD' }, schemeOf(vac(A))).parts.qualification === 30);
  check('Same applicant (PhD, 3 yrs, 2 pubs, 3 seminars): 30 + 15 + (8+6) = 59 with maxima', scoreOf(A, 'ann') === 59, String(scoreOf(A, 'ann')));
  check('Same applicant on a legacy vacancy: 40 + 15 + 8 + 6 = 69 (unchanged old behaviour)', scoreOf(LEG, 'ann') === 69, String(scoreOf(LEG, 'ann')));
  const bob = await mkApplicant('bob');
  await apply(bob, A, { experience_years: '30', publications_text: Array.from({ length: 10 }, (_, i) => `P${i}`), seminars_text: Array.from({ length: 10 }, (_, i) => `S${i}`) });
  await apply(bob, LEG, { experience_years: '30', publications_text: Array.from({ length: 10 }, (_, i) => `P${i}`), seminars_text: Array.from({ length: 10 }, (_, i) => `S${i}`) });
  check('Every part capped (PhD, 30 yrs, 10 pubs, 10 seminars): 30 + 20 + 20 = 70', scoreOf(A, 'bob') === 70, String(scoreOf(A, 'bob')));
  check('Legacy vacancy still caps the whole score at 100 (raw 250)', scoreOf(LEG, 'bob') === 100, String(scoreOf(LEG, 'bob')));
  const cy = await mkApplicant('cy');
  await apply(cy, A, { highest_qualification: 'Bachelor', experience_years: '1', publications_text: ['P1', 'P2', 'P3', 'P4'], seminars_text: ['S1', 'S2', 'S3', 'S4', 'S5'] });
  check('Publications and seminars share one cap (4x4 + 5x2 = 26 counts as 20)', scoreOf(A, 'cy') === 10 + 5 + 20, String(scoreOf(A, 'cy')));
  const aid = db.prepare("SELECT id FROM applications WHERE vacancy_id = ? AND user_id = (SELECT id FROM users WHERE email='ann@a.com')").get(A).id;
  await admin.post(`/admin/applications/${aid}/academic-score`, { highest_qualification: 'Master', experience_years: 2, journal_publications_count: 0, seminars_attended: 0 });
  check('HR recalculation uses the maxima (Master 25 + 10 = 35)', row(aid).academic_score === 35, String(row(aid).academic_score));
  await admin.post(`/admin/applications/${aid}/academic-score`, { highest_qualification: 'PhD', experience_years: 3, journal_publications_count: 2, seminars_attended: 3 });

  // ================================================================ 3. interview stage: personal data + interview, two decimals
  db.prepare("UPDATE applications SET status='Shortlisted', shortlisted=1 WHERE id = ?").run(aid);
  r = await admin.req('GET', `/admin/applications/${aid}`);
  check('Detail page shows a personal data score field (max 10) and interview field (max 20)', /name="personal_data_score"[^>]*max="10"/.test(r.text) && /name="interview_score"[^>]*max="20"/.test(r.text) && /step="0.01"/.test(r.text));
  const bad = [['interview 21 (above max 20)', { interview_score: '21', personal_data_score: '5' }], ['interview 17.755 (3 decimals)', { interview_score: '17.755', personal_data_score: '5' }],
    ['interview negative', { interview_score: '-1', personal_data_score: '5' }], ['interview 1e1', { interview_score: '1e1', personal_data_score: '5' }], ['interview text', { interview_score: 'abc', personal_data_score: '5' }],
    ['interview blank', { interview_score: '', personal_data_score: '5' }], ['personal data 10.01 (above max 10)', { interview_score: '10', personal_data_score: '10.01' }],
    ['personal data negative', { interview_score: '10', personal_data_score: '-0.5' }], ['personal data text', { interview_score: '10', personal_data_score: 'x' }], ['personal data blank', { interview_score: '10', personal_data_score: '' }],
    ['personal data missing', { interview_score: '10' }]];
  for (const [name, f] of bad) { r = await interview(aid, f); check(`Rejected: ${name}`, isErr(r) && row(aid).interview_score === null && row(aid).personal_data_score === null, r.loc.slice(0, 80)); }
  r = await interview(aid, { interview_score: '17.75', personal_data_score: '9.25' });
  check('Two decimals accepted and stored exactly (17.75 and 9.25)', r.status === 302 && !/type=error/.test(r.loc) && row(aid).interview_score === 17.75 && row(aid).personal_data_score === 9.25, `${row(aid).interview_score} / ${row(aid).personal_data_score}`);
  r = await interview(aid, { interview_score: '20', personal_data_score: '10' });
  check('The maxima themselves (20 and 10) are accepted', row(aid).interview_score === 20 && row(aid).personal_data_score === 10);
  r = await interview(aid, { interview_score: '0', personal_data_score: '0' });
  check('Zero is accepted', !isErr(r) && row(aid).interview_score === 0 && row(aid).personal_data_score === 0);
  r = await interview(aid, { interview_score: '17.75', personal_data_score: '9.25' });
  const lg = logs('INTERVIEW_RECORDED').pop() || '';
  check('Audit log records old and new interview and personal data scores', /Interview score 0 -> 17.75; personal data score 0 -> 9.25/.test(lg), lg.slice(0, 120));

  // ================================================================ 4. combined total
  r = await admin.req('GET', `/admin/applications/${aid}`);
  const txt = r.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  check('Detail page shows the breakdown rows (personal data, qualification, experience, publications, interview)', /Personal data 10 9\.25/.test(txt) && /Educational qualification[^|]*? 30 30/.test(txt) && /Relevant experience[^|]*? 20 15/.test(txt) && /Publications and seminars[^|]*? 20 14/.test(txt) && /Physical interview 20 17\.75/.test(txt));
  check('Detail page shows the combined total 86 (59 + 9.25 + 17.75) out of 100', /Combined total 100 86/.test(txt), (txt.match(/Combined total.{0,30}/) || [''])[0]);
  r = await admin.req('GET', `/vacancies/${A}/applications`);
  check('Applicants list has Personal data and Total /100 columns with this applicant at 86', /Total \/100/.test(r.text) && /Personal data/.test(r.text) && /<strong>86<\/strong>/.test(r.text));
  let c = await csv(A);
  const annRow = c.rows.find((x) => x.Name === 'ann');
  check('Merit CSV has the component columns and total', c.status === 200 && ['Qualification', 'Experience', 'Publications', 'Personal data', 'Total /100', 'Slots'].every((h) => c.head.includes(h)));
  check('Merit CSV row: 30 / 15 / 14 / 9.25 / total 86, academic part 59, interview 17.75', annRow && annRow.Qualification === '30' && annRow.Experience === '15' && annRow.Publications === '14' && annRow['Personal data'] === '9.25' && annRow['Total /100'] === '86' && annRow['Academic pts'] === '59' && annRow.Interview === '17.75', JSON.stringify(annRow));
  const pdf = await fetch(`${base}/admin/reports/merit/pdf?vacancy_id=${A}`, { headers: { cookie: Object.entries(admin.cookies).map(([k, v]) => `${k}=${v}`).join('; ') } });
  check('Merit PDF works for a vacancy with maxima', pdf.status === 200 && Buffer.from(await pdf.arrayBuffer()).slice(0, 4).toString() === '%PDF');
  const bobId = db.prepare("SELECT id FROM applications WHERE vacancy_id = ? AND user_id = (SELECT id FROM users WHERE email='bob@a.com')").get(A).id;
  db.prepare("UPDATE applications SET status='Shortlisted', shortlisted=1 WHERE id = ?").run(bobId);
  await interview(bobId, { interview_score: '20', personal_data_score: '10' });
  r = await admin.req('GET', `/admin/applications/${bobId}`);
  check('Best possible applicant totals exactly 100 (30+20+20+10+20)', /Combined total 100 100/.test(r.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')));
  const cyId = db.prepare("SELECT id FROM applications WHERE vacancy_id = ? AND user_id = (SELECT id FROM users WHERE email='cy@a.com')").get(A).id;
  db.prepare("UPDATE applications SET status='Shortlisted', shortlisted=1 WHERE id = ?").run(cyId);
  c = await csv(A);
  const cyRow = c.rows.find((x) => x.Name === 'cy');
  check('Missing personal data / interview scores count as 0 in the total (cy: 35)', cyRow && cyRow['Total /100'] === '35' && cyRow['Personal data'] === '', JSON.stringify(cyRow));

  // ================================================================ 5. ranking + tie-break (exam on), slots
  await mkVac({ title: 'Rank Exam', category: 'academic' });
  const R = vacId('Rank Exam');
  await admin.post(settingsOf(R), { ...okSettings, academic_exam_enabled: 1 });
  check('Exam switched on for the ranking vacancy', vac(R).academic_exam_enabled === 1);
  // combined: P4 98, P5 80, P6 70, P3 = P2 = P1 = 65.  Old rule (academic part only) would put P6 (70) above P5 (50).
  addApp(R, 'P1', { q: 'Master', years: 4, personal: 10, interview: 10, exam: 50 });
  addApp(R, 'P2', { q: 'Master', years: 4, personal: 10, interview: 10, exam: 70 });
  addApp(R, 'P3', { q: 'Master', years: 4, personal: 8, interview: 12, exam: 70 });
  addApp(R, 'P4', { q: 'PhD', years: 4, pubs: 5, personal: 10, interview: 18, exam: 10 });
  addApp(R, 'P5', { q: 'Bachelor', years: 4, pubs: 5, personal: 10, interview: 20, exam: 90 });
  addApp(R, 'P6', { q: 'PhD', years: 4, pubs: 5, personal: 0, interview: 0, exam: 95 });
  c = await csv(R);
  const order = c.rows.map((x) => x.Name).join();
  check('Ranked by combined total, ties by exam %, then interview: P4, P5, P6, P3, P2, P1', order === 'P4,P5,P6,P3,P2,P1', order);
  check('Totals in that list: 98, 80, 70, 65, 65, 65', c.rows.map((x) => x['Total /100']).join() === '98,80,70,65,65,65', c.rows.map((x) => x['Total /100']).join());
  check('Ranks are 1 to 6', c.rows.map((x) => x.Rank).join() === '1,2,3,4,5,6');
  check('A higher exam % does not beat a higher combined total (P6 exam 95 ranks below P5 exam 90? no: P5 total 80 beats P6 total 70)', order.indexOf('P5') < order.indexOf('P6'));
  check('Without maxima the same people would rank differently (academic part: P6 70 > P5 50), so the combined rule is really used', 70 > 50 && order.indexOf('P5') < order.indexOf('P6'));
  check('No slots set: no "Within slots" marker', c.rows.every((x) => x.Slots === ''));
  r = await admin.post(settingsOf(R), { ...okSettings, academic_exam_enabled: 1, slots: '2' });
  c = await csv(R);
  check('Slots = 2 marks exactly the top 2 as "Within slots" (P4, P5)', c.rows.filter((x) => x.Slots === 'Within slots').map((x) => x.Name).join() === 'P4,P5', c.rows.map((x) => x.Slots).join('|'));
  check('Slots change is audit-logged', logs('VACANCY_SETTINGS_CHANGED').some((d) => /positions not set/.test(d) && /positions 2/.test(d)));
  check('The marker changes nothing else: statuses stay Shortlisted', c.rows.every((x) => x.Status === 'Shortlisted'));
  // exam OFF: ties broken by interview only
  await mkVac({ title: 'Rank NoExam', category: 'academic' });
  const R2 = vacId('Rank NoExam');
  addApp(R2, 'Q1', { q: 'Master', years: 4, personal: 10, interview: 8 });  // 45+10+8 = 63
  addApp(R2, 'Q2', { q: 'Master', years: 4, personal: 5, interview: 13 });  // 63, higher interview
  addApp(R2, 'Q3', { q: 'Master', years: 4, personal: 10, interview: 10 }); // 65
  c = await csv(R2);
  check('Exam off: ranked by total, tie broken by interview (Q3 65, Q2 63/13, Q1 63/8)', c.rows.map((x) => x.Name).join() === 'Q3,Q2,Q1' && c.rows.every((x) => x.Result === '' && x['Exam %'] === ''), c.rows.map((x) => x.Name).join());
  // positions marker value limits
  for (const [name, v] of [['zero', '0'], ['negative', '-2'], ['decimal', '1.5'], ['text', 'x'], ['above 1000', '1001']]) {
    r = await admin.post(settingsOf(R2), { ...okSettings, slots: v });
    check(`Positions rejected: ${name}`, r.status === 400 && vac(R2).slots === null, `status ${r.status}`);
  }
  r = await admin.post(settingsOf(R2), { ...okSettings, slots: '' });
  check('Positions can stay empty', r.status === 302 && vac(R2).slots === null);

  // ================================================================ settings page: maxima rules + guards
  r = await admin.req('GET', settingsOf(R2));
  check('Settings page shows the five maxima and the positions field', MAXKEYS.every((k) => new RegExp(`name="${k}"`).test(r.text)) && /name="slots"/.test(r.text));
  const nl = logs('VACANCY_SETTINGS_CHANGED').length;
  for (const [name, o] of [['sum 99', { max_interview: 19 }], ['sum 101', { max_qualification: 31 }], ['negative', { max_experience: '-1' }], ['decimal', { max_publications: '2.5' }], ['above 100', { max_personal_data: '101' }], ['text', { max_interview: 'x' }], ['one empty', { max_interview: '' }]]) {
    r = await admin.post(settingsOf(R2), { ...okSettings, ...o });
    check(`Settings rejected: ${name}`, r.status === 400, `status ${r.status}`);
  }
  check('Rejected settings changed nothing and wrote no audit entry', maxOf(vac(R2)) === '30,20,20,10,20' && logs('VACANCY_SETTINGS_CHANGED').length === nl);
  r = await admin.post(settingsOf(R2), { ...okSettings, max_qualification: 20, max_experience: 20, max_publications: 20, max_personal_data: 10, max_interview: 30 });
  check('A valid new split is saved and audit-logged (before and after)', r.status === 302 && maxOf(vac(R2)) === '20,20,20,10,30' && /maxima Qualification 30.*maxima Qualification 20/.test((logs('VACANCY_SETTINGS_CHANGED').pop() || '')));
  check('Changing the maxima rescored the applicants (Master 25 -> capped 20; 20 + 20 = 40)', db.prepare("SELECT academic_score s FROM applications WHERE vacancy_id = ? LIMIT 1").get(R2).s === 40);
  r = await admin.post(settingsOf(R2), { ...okSettings, max_interview: 15, max_publications: 25 });
  check('A maximum below an interview score already recorded (13) is accepted only above it; 15 is above 13', r.status === 302);
  r = await admin.post(settingsOf(R2), { ...okSettings, max_qualification: 33, max_experience: 20, max_publications: 25, max_personal_data: 10, max_interview: 12 });
  check('A maximum below an interview score already recorded (13) is refused', r.status === 400 && /already recorded/.test(r.text) && vac(R2).max_interview === 15);
  r = await admin.post(settingsOf(R2), { ...okSettings, max_qualification: 30, max_experience: 20, max_publications: 25, max_personal_data: 4, max_interview: 21 });
  check('A personal data maximum below a recorded personal data score (10) is refused', r.status === 400 && /already recorded/.test(r.text));
  const ann2 = new Client(base); await ann2.login('ann@a.com', 'passw0rdX');
  r = await ann2.post(settingsOf(R2), okSettings);
  check('Applicants cannot change the maxima (403)', r.status === 403);

  // ================================================================ 6. legacy vacancies unchanged
  const L = vacId('Old Row');
  addApp(L, 'L1', { q: 'PhD', years: 3, pubs: 2, sems: 3, interview: 10 });   // 69, interview 10
  addApp(L, 'L2', { q: 'Bachelor', years: 2, interview: 100 });                // 20, interview 100
  addApp(L, 'L3', { q: 'PhD', years: 3, pubs: 2, sems: 3, interview: 60 });   // 69, higher interview
  c = await csv(L);
  check('Legacy ranking is unchanged: academic score, then interview (L3 69/60, L1 69/10, L2 20/100)', c.rows.map((x) => x.Name).join() === 'L3,L1,L2', c.rows.map((x) => x.Name).join());
  check('Legacy merit rows have empty combined columns and show the plain academic score', c.rows.every((x) => x.Qualification === '' && x['Total /100'] === '' && x['Personal data'] === '' && x.Slots === '') && c.rows[0]['Academic pts'] === '69');
  const l1 = db.prepare("SELECT a.id FROM applications a JOIN users u ON u.id = a.user_id WHERE u.name = 'L1'").get().id;
  r = await admin.req('GET', `/admin/applications/${l1}`);
  check('Legacy detail page has no recruitment-score card and no personal data field', !/Recruitment score/.test(r.text) && !/personal_data_score/.test(r.text) && /Total academic score/.test(r.text) && /\/100/.test(r.text));
  r = await admin.req('GET', `/vacancies/${L}/applications`);
  check('Legacy applicants list has no Total column', !/Total \/100/.test(r.text));
  r = await interview(l1, { interview_score: '100', personal_data_score: '7' });
  check('Legacy interview score allows up to 100', !isErr(r) && row(l1).interview_score === 100);
  check('A personal data score posted for a legacy vacancy is ignored (stays NULL)', row(l1).personal_data_score === null);
  r = await interview(l1, { interview_score: '100.5' });
  check('Legacy interview score above 100 refused', isErr(r) && row(l1).interview_score === 100);
  r = await interview(l1, { interview_score: '85.5' });
  check('Legacy interview score accepts two decimals (85.5)', !isErr(r) && row(l1).interview_score === 85.5);
  r = await interview(l1, { interview_score: '85.555' });
  check('Legacy interview score refuses three decimals', isErr(r) && row(l1).interview_score === 85.5);
  r = await admin.req('GET', settingsOf(L));
  check('Legacy settings page shows the maxima fields empty', MAXKEYS.every((k) => new RegExp(`name="${k}"[^>]*value=""`).test(r.text)));
  r = await admin.post(settingsOf(L), { ...okSettings, max_interview: 20 });
  check('A legacy vacancy cannot get maxima with an interview score of 100/85.5 already recorded', r.status === 400 && /already recorded/.test(r.text) && vac(L).max_interview === null);
  db.prepare('UPDATE applications SET interview_score = 10 WHERE vacancy_id = ?').run(L);
  r = await admin.post(settingsOf(L), { ...okSettings });
  check('Legacy -> maxima through the settings page works and rescoring applies (69 becomes 59)', r.status === 302 && maxOf(vac(L)) === '30,20,20,10,20' && db.prepare("SELECT academic_score s FROM applications a JOIN users u ON u.id=a.user_id WHERE u.name='L1'").get().s === 59);
  r = await admin.post(settingsOf(L), { ...okSettings, max_qualification: '', max_experience: '', max_publications: '', max_personal_data: '', max_interview: '' });
  check('Maxima -> legacy (all empty) restores the old scoring (back to 69)', r.status === 302 && vac(L).max_interview === null && db.prepare("SELECT academic_score s FROM applications a JOIN users u ON u.id=a.user_id WHERE u.name='L1'").get().s === 69);

  // ================================================================ 7. non-academic unchanged
  const NA = vacId('Non Acad');
  addApp(NA, 'N1', { exam: 60, interview: 50 });
  addApp(NA, 'N2', { exam: 80, interview: 10 });
  addApp(NA, 'N3', { exam: 80, interview: 40 });
  c = await csv(NA);
  check('Non-academic ranking is unchanged: exam % then interview (N3, N2, N1)', c.rows.map((x) => x.Name).join() === 'N3,N2,N1', c.rows.map((x) => x.Name).join());
  check('Non-academic merit rows have empty academic and combined columns', c.rows.every((x) => x['Academic pts'] === '' && x['Total /100'] === '' && x.Qualification === ''));
  const n3 = db.prepare("SELECT a.id FROM applications a JOIN users u ON u.id = a.user_id WHERE u.name = 'N3'").get().id;
  r = await admin.req('GET', `/admin/applications/${n3}`);
  check('Non-academic detail page has no recruitment-score card', r.status === 200 && !/Recruitment score/.test(r.text) && !/personal_data_score/.test(r.text));
  r = await interview(n3, { interview_score: '99.25', personal_data_score: '9' });
  check('Non-academic interview score: 0-100 with two decimals; personal data ignored', !isErr(r) && row(n3).interview_score === 99.25 && row(n3).personal_data_score === null);
  r = await interview(n3, { interview_score: '101' });
  check('Non-academic interview score above 100 refused', isErr(r) && row(n3).interview_score === 99.25);
  r = await admin.req('GET', settingsOf(NA));
  check('Non-academic settings page does not offer the maxima', r.status === 200 && !/name="max_qualification"/.test(r.text) && /name="slots"/.test(r.text));
  r = await admin.post(settingsOf(NA), { ...okSettings, slots: '1' });
  c = await csv(NA);
  check('Positions also work for a non-academic vacancy (top 1 = N3 "Within slots")', r.status === 302 && c.rows.filter((x) => x.Slots === 'Within slots').map((x) => x.Name).join() === 'N3');
  check('Maxima stay NULL for the non-academic vacancy after saving settings', vac(NA).max_qualification === null && vac(NA).max_interview === null);

  const failed = results.filter((x) => !x.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('E2E crashed', e); process.exit(1); });
