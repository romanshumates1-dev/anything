// Cost of the BATCHED dashboard endpoint, compared with the endpoints it replaces.
//
// Sequential with gaps, for the same reason as _probe-endpoint-cost.mjs:
// production is not a load lab. Three sequential calls of each, one endpoint at a
// time, which is the least traffic that can attribute a cost.
//
// Run with `wrangler tail` attached to capture Cloudflare's per-request cpuTime.
import { readFileSync } from 'node:fs';

const cred = JSON.parse(readFileSync(process.env.TEMP + '/qa-cred.json', 'utf8'));
const BASE = cred.base;

const signin = await fetch(`${BASE}/api/auth/sign-in/email`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: BASE },
  body: JSON.stringify({ email: cred.email, password: cred.password }),
});
if (!signin.ok) {
  console.error('sign-in failed:', signin.status);
  process.exit(1);
}
const cookie = (signin.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
console.log('signed in\n');

const REPS = 3;

async function measure(label, path) {
  const rows = [];
  let keys = null;
  for (let i = 0; i < REPS; i++) {
    const t0 = Date.now();
    let status = 'THROW';
    let bytes = 0;
    try {
      const r = await fetch(BASE + path, { headers: { cookie, origin: BASE } });
      status = r.status;
      const body = await r.text();
      bytes = body.length;
      if (i === 0) {
        try {
          const json = JSON.parse(body);
          keys = Array.isArray(json) ? 'array' : Object.keys(json).join(',');
        } catch {
          keys = '(not json)';
        }
      }
    } catch {
      status = 'THROW';
    }
    rows.push({ ms: Date.now() - t0, status, bytes });
    console.log(`  ${label} #${i + 1}: ${status} ${rows[rows.length - 1].ms}ms ${bytes}b`);
    await new Promise((r) => setTimeout(r, 1500));
  }
  const ok = rows.filter((r) => r.status === 200);
  const mean = ok.length ? Math.round(ok.reduce((a, r) => a + r.ms, 0) / ok.length) : -1;
  console.log(`  -> ${label} mean ${mean}ms  keys: ${keys}\n`);
  return mean;
}

const batch = await measure('summary   ', '/api/dashboard/summary');

// Two of the ten slices it replaced, for a like-for-like comparison.
const funnel = await measure('funnel    ', '/api/dashboard/funnel');
const weekly = await measure('weekly    ', '/api/dashboard/weekly-progress');

console.log('=== SUMMARY ===');
console.log(`batched endpoint mean        : ${batch}ms`);
console.log(`one slice standalone mean    : ${Math.min(funnel, weekly)}ms`);
console.log(`ten slices sequential (est.) : ${(Math.min(funnel, weekly) * 10)}ms`);
console.log(`batch replaces that with     : ${batch}ms`);
