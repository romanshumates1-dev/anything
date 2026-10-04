// Is the sign-in limiter ATOMIC under concurrency?
//
// better-auth's memory store does read-decide-write, and the source comment
// claims it "is atomic under single-threaded JS". But the awaits around the
// decision let interleaved requests each read count=0 and each write count=1,
// so N truly-simultaneous attempts could all be admitted. If so the brute-force
// guard is bypassable by firing attempts in parallel — a real security finding,
// and it would also explain the earlier "6 parallel = 6 ok" result.
//
// Method: sleep past the window, then fire a single simultaneous burst with no
// delay between requests. max is 3 per 10s, so >3 admitted == racy.
//
// ── CORRECTION 2026-10-04: THIS SCRIPT PRODUCED A FALSE POSITIVE ──────────────
// It previously reported "burst=8 -> admitted=4 *** RACY ***". That was NOT a
// bypass. Two things were wrong with the measurement:
//
//   1. It slept 12s to "drain the window", but `rateLimitByUser` uses FIXED
//      windows keyed on `floor(now / windowMs)` — the bucket resets on a
//      wall-clock boundary, not 10s after the previous burst. A burst that
//      straddles a boundary legitimately sees the tail of one window and the
//      head of the next, and can be admitted up to ~2x. That tradeoff is
//      documented in rateLimit.ts.
//   2. It ran against whatever `cred.base` pointed at with no isolation check.
//
// Re-tested properly by scripts/_signin-limit-forensics.mjs, which parks bursts
// mid-window: 5 bursts, 40 concurrent requests, admitted == 3 every time, never
// more. The limit HOLDS. Do not "fix" the limiter on the basis of this script's
// old output.
//
// Kept in place because the boundary case is real and worth re-checking if the
// limiter changes. It now refuses to run anywhere except the load-test worker.
import { readFileSync } from 'node:fs';

const cred = JSON.parse(readFileSync(process.env.TEMP + '/qa-cred.json', 'utf8'));
const BASE = cred.base;

// Never burst the production apex: a previous session caused a real ~90s
// outage that way. Require the disposable worker explicitly.
if (!BASE || !BASE.includes('loadtest')) {
  console.error(`REFUSING to run: BASE must be the load-test worker, got "${BASE}"`);
  console.error('Use scripts/_signin-limit-forensics.mjs, which is boundary-aware.');
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

for (const burst of [3, 5, 8]) {
  await new Promise((r) => setTimeout(r, 12000)); // drain the window first
  const t0 = Date.now();
  const statuses = await Promise.all(Array.from({ length: burst }, fire));
  const admitted = statuses.filter((s) => s === 200).length;
  const limited = statuses.filter((s) => s === 429).length;
  console.log(
    `burst=${burst} in ${Date.now() - t0}ms -> admitted=${admitted} limited=${limited}  ${JSON.stringify(statuses)}  ${admitted > 3 ? '*** RACY: limit bypassed ***' : 'limit held'}`
  );
}
