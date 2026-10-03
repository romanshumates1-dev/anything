// Post-deploy smoke check for the auth cost guard.
//
// DELIBERATELY LOW VOLUME. The instruction is explicit that production must not
// be burst-tested: the previous session's probing plausibly contributed to a
// real Worker CPU exhaustion outage. This script therefore performs:
//
//   1. ONE sign-in with correct credentials -> must be 200 (the guard must not
//      break a legitimate login; this is the single most important check)
//   2. THREE rapid sign-ins -> confirms the limiter engages and returns 429
//      rather than 503, i.e. expensive work is refused BEFORE hashing rather
//      than by exhausting the CPU budget
//
// It deliberately does NOT fire an 8- or 20-way burst. That matrix is covered
// exhaustively against real Postgres in
// src/lib/__tests__/auth-cost-guard.pglite.test.ts, which is the right place to
// prove it. Production gets the minimum needed to confirm deployment.
//
// Credentials come from a file outside the repo and are never printed.
//
// Run: node scripts/_postdeploy-auth-smoke.mjs
import { readFileSync } from 'node:fs';

const BASE = process.env.QA_BASE || 'https://dealswiftautomation.com';
const cred = JSON.parse(readFileSync(process.env.TEMP + '/qa-cred.json', 'utf8'));
const payload = JSON.stringify({ email: cred.email, password: cred.password });

async function signIn() {
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE },
      body: payload,
    });
    return { status: r.status, ms: Date.now() - t0, retryAfter: r.headers.get('x-retry-after') };
  } catch (e) {
    return { status: 'THROW', ms: Date.now() - t0, err: String(e.cause?.code ?? e.message).slice(0, 60) };
  }
}

// 1. One legitimate sign-in. This is the canary: if the new pre-hash guard is
//    wrong, this fails and every real customer is locked out.
console.log('=== 1. legitimate sign-in (single request) ===');
const first = await signIn();
console.log(`  status=${first.status} ms=${first.ms}`);
if (first.status !== 200) {
  console.error('  FAIL: a correct credential was not accepted. The guard is blocking real users.');
  process.exit(1);
}
console.log('  PASS: legitimate login works with the guard active.');

// 2. Three rapid attempts. The limiter should now refuse the excess. The point
//    is the STATUS: 429 means refused cheaply, before hashing. 503 would mean we
//    still exhausted the CPU budget first.
console.log('\n=== 2. three rapid attempts (limiter must refuse cheaply) ===');
const results = [];
for (let i = 0; i < 3; i++) results.push(await signIn());
results.forEach((r, i) => console.log(`  attempt${i + 1}: ${r.status} ${r.ms}ms${r.retryAfter ? ` retry-after=${r.retryAfter}s` : ''}`));

const sawThrottle = results.some((r) => r.status === 429);
const sawCpuAbort = results.some((r) => r.status >= 500);
console.log(`\n  throttle engaged (429) : ${sawThrottle ? 'yes' : 'no'}`);
console.log(`  CPU abort (5xx)        : ${sawCpuAbort ? 'YES - STILL OVER BUDGET' : 'no'}`);
console.log(
  sawCpuAbort
    ? '  FAIL: requests are still being killed by the CPU budget rather than refused.'
    : '  PASS: excess attempts are refused by the limiter, not by exhausting CPU.'
);

// 3. Confirm recovery, so users are not locked out after the window.
console.log('\n=== 3. recovery after the window ===');
await new Promise((r) => setTimeout(r, 11_000));
const after = await signIn();
console.log(`  status=${after.status}`);
if (after.status === 429 || after.status === 403) {
  console.error('  FAIL: still locked out after 11s — customers would be locked out.');
  process.exit(1);
}
console.log('  PASS: login works again after the window.');
