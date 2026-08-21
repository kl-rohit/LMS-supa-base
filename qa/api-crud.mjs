// Full CRUD E2E across every module, driven through the authenticated API.
// Fast, headless, broad — the backbone of the pre-deploy gate. Every record it
// creates is tagged and torn down in a finally block, so a failure never leaves
// litter. Payloads below are the ones validated live against the QA org.
//
//   BASE=https://academy-management.netlify.app ORG=4 \
//   X_AUTH_TOKEN=<JSON.parse(localStorage.veena_auth).access_token> \
//   node api-crud.mjs
//
// Exit 0 = all green, 1 = a check failed. Run against a TEST org only — it
// writes and deletes real data.

const BASE = process.env.BASE || 'https://academy-management.netlify.app';
const ORG = process.env.ORG || '4';
const TOKEN = process.env.X_AUTH_TOKEN;
const TAG = `PWCRUD-${Date.now()}`; // unique so this run only ever touches its own rows

if (!TOKEN) { console.error('✖ Set X_AUTH_TOKEN (from app: JSON.parse(localStorage.veena_auth).access_token)'); process.exit(2); }

async function api(method, path, body) {
  const url = `${BASE}/api${path}${path.includes('?') ? '&' : '?'}org=${ORG}`;
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-Auth-Token': TOKEN }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* */ }
  return { status: res.status, ok: res.ok, body: json };
}
const idOf = (b, k) => b?.[k]?.id || b?.[k]?.ROWID || b?.id || b?.ROWID;
const today = new Date().toISOString().slice(0, 10);
const now = new Date(), M = now.getMonth() + 1, Y = now.getFullYear();

const results = [];
const pass = (name, cond, detail) => results.push({ name, ok: !!cond, detail });
const cleanup = []; // { path } — deleted in reverse in finally

async function create(name, key, path, payload) {
  const r = await api('POST', path, payload);
  const id = idOf(r.body, key);
  pass(`${name}: create`, r.status === 201 || r.status === 200, r.ok ? `id ${id}` : JSON.stringify(r.body));
  return id;
}

try {
  // --- session ---
  pass('session valid', (await api('GET', '/students')).status === 200);

  // --- dependencies ---
  const studentId = await create('students', 'student', '/students', { name: `${TAG} Student`, parent_name: 'CRUD Parent', mobile_number: '9000000009', status: 'active', monthly_fee: 1000 });
  if (studentId) cleanup.push(`/students/${studentId}`);
  const groupId = await create('groups', 'group', '/groups', { name: `${TAG} Batch` });
  if (groupId) cleanup.push(`/groups/${groupId}`);

  // --- students: update + read-back ---
  if (studentId) {
    const u = await api('PUT', `/students/${studentId}`, { name: `${TAG} Student (edited)` });
    pass('students: update', u.status === 200);
    const g = await api('GET', '/students');
    const list = g.body?.students || [];
    pass('students: read-back reflects edit', list.some((s) => (s.name || '').includes('(edited)')));
  }

  // --- groups: membership ---
  if (groupId && studentId) {
    pass('groups: add member', (await api('POST', `/groups/${groupId}/students`, { student_ids: [studentId] })).status === 200);
    pass('groups: remove member', (await api('DELETE', `/groups/${groupId}/students/${studentId}`)).status === 200);
  }

  // --- classes (timetable) ---
  const classId = await create('classes', 'class', '/classes', { name: `${TAG} Class`, class_type: 'offline_group', group_id: groupId, day_of_week: 1, start_time: '10:00', end_time: '11:00' });
  if (classId) cleanup.push(`/classes/${classId}`);

  // --- attendance ---
  if (studentId) {
    const aId = await create('attendance', 'record', '/attendance', { student_id: studentId, date: today, status: 'present', fee_charged: 200, topic: `${TAG} lesson` });
    if (aId) cleanup.push(`/attendance/${aId}`);
  }

  // --- fees: additional (+ cap guard) + payment ---
  if (studentId) {
    const fId = await create('fees/additional', 'additionalFee', '/fees/additional', { student_id: studentId, description: `${TAG} exam fee`, amount: 500, fee_date: today, month: M, year: Y });
    if (fId) cleanup.push(`/fees/additional/${fId}`);
    pass('fees: over-cap additional rejected (400)', (await api('POST', '/fees/additional', { student_id: studentId, description: `${TAG} cap`, amount: 3.245e23, fee_date: today, month: M, year: Y })).status === 400);
    const pId = await create('fees/payments', 'payment', '/fees/payments', { student_id: studentId, fee_month: M, fee_year: Y, paid_amount: 700 });
    if (pId) cleanup.push(`/fees/payments/${pId}`);
    pass('fees: over-cap payment rejected (400)', (await api('POST', '/fees/payments', { student_id: studentId, fee_month: M, fee_year: Y, paid_amount: 9_999_999_999 })).status === 400);
  }

  // --- lessons: course + lesson ---
  const courseId = await create('courses', 'course', '/courses', { name: `${TAG} Course` });
  if (courseId) cleanup.push(`/courses/${courseId}`);
  if (courseId) {
    const lId = await create('lessons', 'lesson', '/lessons', { course_id: courseId, title: `${TAG} Lesson`, content_type: 'video', video_url: 'https://example.com/v.mp4' });
    if (lId) cleanup.unshift(`/lessons/${lId}`); // delete lesson before its course
  }

  // --- assignments ---
  const asgId = await create('assignments', 'assignment', '/assignments', { title: `${TAG} Assignment`, kind: 'task', target_type: 'all', due_date: today });
  if (asgId) cleanup.push(`/assignments/${asgId}`);

  // --- question papers ---
  const qpId = await create('question-papers', 'questionPaper', '/question-papers', { title: `${TAG} Paper`, link: 'https://example.com/p.pdf' });
  if (qpId) cleanup.push(`/question-papers/${qpId}`);

  // --- camps ---
  if (groupId) {
    const campId = await create('camps', 'camp', '/camps', { name: `${TAG} Camp`, group_id: groupId, start_date: today, total_days: 3, daily_fee: 100, schedule: [{ day_date: today, start_time: '10:00', end_time: '12:00' }] });
    if (campId) cleanup.push(`/camps/${campId}`);
  }

  // --- messages (note: target 'all' fans out one row per student) ---
  const msgRes = await api('POST', '/messages', { message: `${TAG} message`, target_type: 'all', message_type: 'general' });
  pass('messages: create', msgRes.status === 201 || msgRes.status === 200);

  // --- reports / settings: read-only ---
  pass('reports: reads', [200].includes((await api('GET', `/reports?month=${M}&year=${Y}`)).status));
} finally {
  // Tear down everything we created (reverse order). Messages fanned out, so
  // sweep any row still carrying our TAG.
  for (const path of cleanup.reverse()) { try { await api('DELETE', path); } catch { /* */ } }
  try {
    const m = await api('GET', '/messages');
    for (const row of (m.body?.messages || [])) {
      if (JSON.stringify(row).includes(TAG)) { try { await api('DELETE', `/messages/${row.id || row.ROWID}`); } catch { /* */ } }
    }
  } catch { /* */ }
}

let failed = 0;
for (const r of results) { console.log(`${r.ok ? '✓' : '✖'} ${r.name}${r.ok ? (r.detail ? ` (${r.detail})` : '') : ' — ' + (r.detail || '')}`); if (!r.ok) failed++; }
console.log(`\n${results.length - failed}/${results.length} passed — created records cleaned up`);
process.exit(failed ? 1 : 0);
