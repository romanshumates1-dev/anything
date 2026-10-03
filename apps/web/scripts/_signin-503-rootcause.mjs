// Root-cause the alternating sign-in 503.
//
// Reproduced on demand: 6 sequential POST /api/auth/sign-in/email returned
// 200,503,200,503,200,503 — strictly alternating. That is deterministic, not
// load noise, and it is NOT the rate limiter (no 429s at all in that run).
// A strict alternation usually means the client is alternating between two
// upstream connections/isolates and only one of them fails, so this script
// captures the failing response in full: status, Cloudflare error code, Ray ID,
// headers and body prefix.
//
// Usage: node --env-file=.env scripts/_signin-503-rootcause.mjs
import { readFileSync } from 'node:fs';

const cred = JSON.parse(readFileSync(process.env.TEMP + '/qa-cred.json', 'utf8'));
const BASE = cred.base;
const payload = JSON.stringify({ email: cred.email, password: cred.password });

const post = () =>
  fetch(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: payload,
  });

const results = [];
for (let i = 0; i < 8; i++) {
  const t0 = Date.now();
  const r = await post().catch(() => null);
  if (!r) { results.push({ i, status: 'THROW', ms: Date.now() - t0 }); continue; }
  const body = await r.text().catch(() => '');
  results.push({
    i,
    status: r.status,
    ms: Date.now() - t0,
    cfRay: r.headers.get('cf-ray'),
    cfCache: r.headers.get('cf-cache-status'),
    cfMitigated: r.headers.get('cf-mitigated'),
    serverTiming: r.headers.get('server-timing'),
    retryAfter: r.headers.get('x-retry-after') ?? r.headers.get('retry-after'),
    contentType: r.headers.get('content-type'),
    bodyLen: body.length,
    body: body.slice(0, 400),
  });
  // Pause past the 10s limiter window between attempts so a 429 can never be
  // what we are looking at; only CPU/edge behaviour remains.
  await new Promise((x) => setTimeout(x, 11_000));
}

for (const r of results) {
  console.log(`\n#${r.i} status=${r.status} ms=${r.ms} cfRay=${r.cfRay} cfMitigated=${r.cfMitigated}`);
  console.log(`   ct=${r.contentType} retryAfter=${r.retryAfter} serverTiming=${r.serverTiming}`);
  console.log(`   bodyLen=${r.bodyLen}`);
  if (r.body) console.log(`   body=${JSON.stringify(r.body)}`);
}

const failing = results.filter((r) => r.status >= 500);
console.log('\n=== SUMMARY ===');
console.log(`attempts=${results.length} 5xx=${failing.length}`);
if (failing.length) {
  const codes = failing
    .map((r) => (r.body.match(/Error\s+(\d{4})/i) || r.body.match(/\b(1102|1101|1012|1000|1020|1027|524|523)\b/) || [])[1])
    .filter(Boolean);
  console.log('CF error codes:', [...new Set(codes)].join(', ') || 'none found in body');
  console.log('distinct cf-ray values:', new Set(failing.map((r) => r.cfRay)).size, 'of', failing.length);
  console.log('all 5xx carry CF error page:', failing.every((r) => /cloudflare|ie6 oldie|Error \d{4}/i.test(r.body)));
}
