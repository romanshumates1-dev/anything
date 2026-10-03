// LOW-VOLUME authenticated endpoint probe.
//
// Deliberately SEQUENTIAL with a gap between calls. Production is not a load
// lab: the dashboard fans out to ~17 endpoints, and firing them concurrently
// would recreate the Worker CPU exhaustion this project already suffered once.
// The goal here is to attribute COST per endpoint, which needs sequential timing,
// not concurrency.
//
// One request per endpoint, one endpoint at a time. That is enough to rank them
// and is the least traffic that answers the question.
//
// Run: node scripts/_probe-endpoint-cost.mjs
import { readFileSync } from 'node:fs';

const BASE = process.env.QA_BASE || 'https://dealswiftautomation.com';
const cred = JSON.parse(readFileSync(process.env.TEMP + '/qa-cred.json', 'utf8'));

// Establish a session cookie via one real sign-in.
const signin = await fetch(`${BASE}/api/auth/sign-in/email`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: BASE },
  body: JSON.stringify({ email: cred.email, password: cred.password }),
});
if (!signin.ok) {
  console.error('sign-in failed:', signin.status);
  process.exit(1);
}
const cookie = (signin.headers.getSetCookie?.() ?? [])
  .map((c) => c.split(';')[0])
  .join('; ');
console.log('signed in, session cookie acquired\n');

// Every endpoint the dashboard fans out to, plus the Shell's own five.
const ENDPOINTS = [
  // Shell
  '/api/usage',
  '/api/user/preferences',
  '/api/system/health',
  '/api/approvals/count',
  '/api/actions?limit=1&include_status=true',
  // dashboard page
  '/api/dashboard/stats',
  // dashboard components
  '/api/campaigns',
  '/api/credits?history=true&limit=10',
  '/api/dashboard/funnel',
  '/api/dashboard/activity',
  '/api/dashboard/next-actions',
  '/api/pipeline?include_config=false',
  '/api/dashboard/quick-stats',
  '/api/dashboard/engagements',
  '/api/dashboard/weekly-progress',
];

const rows = [];
for (const path of ENDPOINTS) {
  const t0 = Date.now();
  let status = 'THROW';
  let bytes = 0;
  try {
    const r = await fetch(BASE + path, { headers: { cookie, origin: BASE } });
    status = r.status;
    bytes = (await r.text()).length;
  } catch {
    status = 'THROW';
  }
  rows.push({ path, status, ms: Date.now() - t0, kb: Math.round(bytes / 1024) });
  console.log(`  ${String(status).padEnd(5)} ${String(Date.now() - t0).padStart(6)}ms ${String(Math.round(bytes / 1024)).padStart(5)}kb  ${path}`);
  await new Promise((r) => setTimeout(r, 1200)); // let the Worker settle between calls
}

const total = rows.reduce((a, r) => a + r.ms, 0);
const failing = rows.filter((r) => r.status >= 400);
const slowest = [...rows].sort((a, b) => b.ms - a.ms).slice(0, 6);

console.log('\n=== SUMMARY ===');
console.log(`endpoints            : ${rows.length}`);
console.log(`sequential total     : ${total}ms`);
console.log(`mean                 : ${Math.round(total / rows.length)}ms`);
console.log(`non-2xx              : ${failing.length}${failing.length ? ' -> ' + failing.map((f) => `${f.path}=${f.status}`).join(', ') : ''}`);
console.log('\nslowest:');
slowest.forEach((r) => console.log(`  ${String(r.ms).padStart(6)}ms ${r.status} ${r.kb}kb  ${r.path}`));
