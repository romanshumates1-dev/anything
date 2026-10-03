// DECISIVE EXPERIMENT: does the 503 track PASSWORD HASHING (argon2) or RATE LIMITING?
//
// Two competing explanations for the same "6 attempts -> ~3 fail" observation:
//   A. better-auth's brute-force guard returns 429.        (my earlier claim)
//   B. argon2 blows the Free-plan CPU budget -> CF 503.   (the original claim)
//
// Discriminator: compare an endpoint that HASHES against one that touches the
// same database but never hashes, at identical request volume.
//   POST /api/auth/sign-in/email        -> hashes (argon2 verify)
//   GET  /api/auth/get-session          -> DB read only, no hashing
//   GET  /api/system/health             -> DB read only, no hashing
//
// If (A) is the whole story, failures are 429 and are spread across all three.
// If (B) is real, 5xx appear ONLY on the hashing endpoint and the other two stay
// clean. Note get-session has no rate-limit special rule (the 3-per-10s rule
// matches only /sign-in*, /sign-up*, /change-password*, /change-email*), so it
// is a clean control for hashing cost with NO limiter confound.
import { readFileSync } from 'node:fs';

const cred = JSON.parse(readFileSync(process.env.TEMP + '/qa-cred.json', 'utf8'));
const BASE = cred.base;
const payload = JSON.stringify({ email: cred.email, password: cred.password });

async function timed(path, init) {
  const t0 = Date.now();
  try {
    const r = await fetch(BASE + path, init);
    return { status: r.status, ms: Date.now() - t0, cf: r.headers.get('cf-ray') };
  } catch {
    return { status: 'THROW', ms: Date.now() - t0 };
  }
}

const report = (label, rows) => {
  const t = {};
  for (const r of rows) t[r.status] = (t[r.status] || 0) + 1;
  const avg = Math.round(rows.reduce((a, r) => a + r.ms, 0) / rows.length);
  console.log(`${label.padEnd(34)} ${JSON.stringify(t).padEnd(28)} avgMs=${avg} maxMs=${Math.max(...rows.map((r) => r.ms))}`);
  return t;
};

const N = 12;
const drain = () => new Promise((r) => setTimeout(r, 11_000));

// Warm the isolate first: a cold start costs CPU and would be miscounted as a
// steady-state failure. Also makes the comparison below fair between endpoints.
await timed('/api/auth/get-session', { headers: { origin: BASE } });
await drain();

const signin = [];
for (let i = 0; i < N; i++) {
  signin.push(await timed('/api/auth/sign-in/email', { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: payload }));
}
const tSignin = report(`POST sign-in (HASHES) x${N}`, signin);

const sess = [];
for (let i = 0; i < N; i++) sess.push(await timed('/api/auth/get-session', { headers: { origin: BASE } }));
const tSess = report(`GET  get-session (no hash) x${N}`, sess);

const health = [];
for (let i = 0; i < N; i++) health.push(await timed('/api/system/health', {}));
const tHealth = report(`GET  system/health (no hash) x${N}`, health);

const fivexx = (t) => Object.entries(t).filter(([k]) => k.startsWith('5')).reduce((a, [, v]) => a + v, 0);
console.log('\n--- VERDICT ---');
console.log(`5xx on hashing endpoint     : ${fivexx(tSignin)}/${N}`);
console.log(`5xx on non-hashing controls : ${fivexx(tSess) + fivexx(tHealth)}/${N * 2}`);
console.log(
  fivexx(tSignin) > 0 && fivexx(tSess) + fivexx(tHealth) === 0
    ? '=> CONFIRMS argon2 hashing overflows the CPU budget (original claim was RIGHT)'
    : fivexx(tSignin) > 0
      ? '=> 5xx on controls too; not isolated to hashing'
      : '=> no 5xx this run; inconclusive, re-run under load'
);

// What does a 503 actually look like?
const first503 = signin.find((r) => r.status === 503);
if (first503) {
  const r = await fetch(`${BASE}/api/auth/sign-in/email`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: payload }).catch(() => null);
  if (r && r.status === 503) {
    const body = await r.text().catch(() => '');
    console.log('\n503 body first 200 chars:', JSON.stringify(body.slice(0, 200)));
    console.log('cf-ray:', r.headers.get('cf-ray'));
    console.log('is CF error page:', /no-js ie6 oldie|Error 1102|cloudflare/i.test(body));
  }
}
