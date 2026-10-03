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
import { readFileSync } from 'node:fs';

const cred = JSON.parse(readFileSync(process.env.TEMP + '/qa-cred.json', 'utf8'));
const BASE = cred.base;
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
