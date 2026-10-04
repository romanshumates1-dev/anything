// IS THE SIGN-IN LIMIT ACTUALLY BYPASSABLE, OR WAS THE FIRST TEST MISREAD?
//
// WHY THIS FILE
// -------------
// `_ratelimit-race.mjs` reported "burst=8 -> admitted=4 *** RACY ***" against a
// documented max of 3. That looks like a live brute-force bypass, and the
// documented cause in `auth-cost-guard.ts` says better-auth's limiter was racy
// and was replaced with an atomic Postgres one.
//
// But `auth-cost-guard.ts` is only part of the picture. There are now TWO limits
// in front of sign-in:
//
//   1. the atomic Postgres guard (auth-cost-guard -> rateLimitByUser),
//      fixed window, 3 per 10s per IP, and
//   2. better-auth's OWN limiter, which still runs.
//
// `rateLimitByUser` uses FIXED windows: `window_start = floor(now / windowMs)`.
// A fixed window admits up to ~2x the limit across a boundary. The previous
// script waited 12s before each burst to "drain the window", but a 10s window
// that restarts on wall-clock boundaries means a burst fired near the boundary
// can legitimately see part of the previous window and part of the next.
//
// So "4 admitted" may be a boundary artifact, a real race, or better-auth's
// limiter having a different threshold. This file separates those cases rather
// than guessing, because the difference is "security defect" vs "no defect".
//
// SAFETY
// ------
// Runs against the DISPOSABLE load-test Worker only (see wrangler.loadtest.jsonc).
// Never the apex. Bounded: 8 concurrent, 5 rounds. Reads nothing but status codes.
import { readFileSync } from 'node:fs';

const cred = JSON.parse(readFileSync(process.env.TEMP + '/qa-cred.json', 'utf8'));
const BASE = cred.base;

if (!BASE || !BASE.includes('loadtest')) {
  console.error(`REFUSING to run: BASE must be the load-test worker, got "${BASE}"`);
  process.exit(2);
}
console.log(`target = ${BASE} (isolated)`);

const payload = JSON.stringify({ email: cred.email, password: cred.password });

const fire = () =>
  fetch(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: payload,
  })
    .then((r) => r.status)
    .catch(() => 'THROW');

const LIMIT = 3;
const WINDOW_MS = 10_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function burst(n) {
  const t0 = Date.now();
  const statuses = await Promise.all(Array.from({ length: n }, fire));
  const admitted = statuses.filter((s) => s === 200).length;
  const limited = statuses.filter((s) => s === 429).length;
  return { n, admitted, limited, statuses, ms: Date.now() - t0 };
}

console.log('\n=== A. MID-WINDOW bursts (deliberately away from any boundary) ===');
let worst = 0;
for (let round = 1; round <= 5; round++) {
  // Park in the MIDDLE of a fresh window: wait out the remainder of the current
  // window, then sleep half of it. A burst here cannot straddle a boundary.
  const now = Date.now();
  const intoWindow = now % WINDOW_MS;
  const toNextBoundary = WINDOW_MS - intoWindow;
  await sleep(toNextBoundary + WINDOW_MS / 2);
  const r = await burst(8);
  worst = Math.max(worst, r.admitted);
  console.log(
    `round ${round}: admitted=${r.admitted} limited=${r.limited} ` +
      `overshoot=${r.admitted > LIMIT ? 'YES' : 'no'} ${JSON.stringify(r.statuses)}`
  );
}
console.log(`\n=> worst mid-window admitted = ${worst} (limit ${LIMIT})`);
console.log(
  worst <= LIMIT
    ? '=> LIMIT HELD when the burst cannot straddle a window boundary.'
    : '=> LIMIT EXCEEDED even mid-window: this is a real bypass, not a boundary artifact.'
);

console.log('\n=== B. boundary-straddling burst (does the fixed window admit ~2x?) ===');
for (let round = 1; round <= 3; round++) {
  // Fire so the burst STARTS just before a boundary and runs into the next one.
  const toNextBoundary = WINDOW_MS - (Date.now() % WINDOW_MS);
  await sleep(Math.max(0, toNextBoundary - 250));
  const r = await burst(8);
  console.log(
    `round ${round}: admitted=${r.admitted} limited=${r.limited} ${JSON.stringify(r.statuses)}`
  );
}
console.log(
  '\n=> If boundary bursts admit more than mid-window bursts, the excess is the\n' +
    '   documented fixed-window tradeoff in rateLimit.ts, not a concurrency race.'
);