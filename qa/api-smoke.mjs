// API smoke gate — the automated backend regression checks (S-FEE-3 etc.).
// No browser needed: just a base URL + a session token.
//
//   BASE=https://academy-management.netlify.app \
//   ORG=4 \
//   X_AUTH_TOKEN=<paste from DevTools: JSON.parse(localStorage.veena_auth).access_token> \
//   node api-smoke.mjs
//
// Exits 0 if all checks pass, 1 otherwise — safe to wire into a pre-deploy step.

const BASE = process.env.BASE || 'https://academy-management.netlify.app';
const ORG = process.env.ORG || '4';
const TOKEN = process.env.X_AUTH_TOKEN;

if (!TOKEN) {
  console.error('✖ Set X_AUTH_TOKEN (from the app: JSON.parse(localStorage.veena_auth).access_token)');
  process.exit(2);
}

async function api(method, path, body) {
  const url = `${BASE}/api${path}${path.includes('?') ? '&' : '?'}org=${ORG}`;
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Auth-Token': TOKEN },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await res.json(); } catch { /* non-json */ }
  return { status: res.status, ok: res.ok, body: json };
}

const now = new Date(), m = now.getMonth() + 1, y = now.getFullYear(), today = now.toISOString().slice(0, 10);
const results = [];
const check = (name, pass, detail) => { results.push({ name, pass, detail }); };

const session = await api('GET', '/students');
check('session valid (GET /students → 200)', session.status === 200, `status ${session.status}`);

const bigFee = await api('POST', '/fees/additional', { student_id: '1', description: 'smoke cap check', amount: 3.245e23, fee_date: today, month: m, year: y });
check('huge additional fee rejected (400)', bigFee.status === 400, bigFee.body?.error || `status ${bigFee.status}`);

const bigPay = await api('POST', '/fees/payments', { student_id: '1', fee_month: m, fee_year: y, paid_amount: 9_999_999_999 });
check('over-cap payment rejected (400)', bigPay.status === 400, bigPay.body?.error || `status ${bigPay.status}`);

const msgs = await api('GET', '/messages');
const list = msgs.body?.messages || msgs.body?.data || msgs.body || [];
const sci = (Array.isArray(list) ? list : []).filter((x) => /e\+\d{2,}/i.test(JSON.stringify(x))).length;
check('no scientific-notation amounts in messages', sci === 0, `${sci} offenders`);

let failed = 0;
for (const r of results) {
  console.log(`${r.pass ? '✓' : '✖'} ${r.name}${r.pass ? '' : ' — ' + r.detail}`);
  if (!r.pass) failed++;
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
