/**
 * ADVERSARIAL SECURITY PROBE (security addendum).
 *
 * Exercises the attack classes that the other gates do not cover: CSRF origin
 * enforcement, path traversal, webhook forgery, XSS reflection, open redirect
 * and security headers. Runs against the PRODUCTION build by default so the
 * header set is the one that actually ships, not the dev server's.
 *
 * The tenant-isolation / IDOR / privilege-escalation classes are covered
 * separately by scripts/tenant-isolation-probe.mjs (15 checks, 0 leaks).
 *
 * Safe by construction: synthetic data only, no destructive action, no real
 * payment, no live webhook.
 *
 * Usage: node scripts/security-probe.mjs [baseUrl]
 */
const BASE = process.argv[2] || 'http://localhost:4001';

let checks = 0;
let failures = 0;

/** Assert a status is one of the acceptable refusals. */
function expectRefusal(label, actual, allowed = [400, 401, 403, 404, 405, 422, 501, 503]) {
  checks++;
  const ok = allowed.includes(actual);
  if (!ok) failures++;
  console.log(
    `  ${actual} ${label}${ok ? '' : `   <<< EXPECTED one of ${allowed.join(',')}`}`
  );
}

async function status(path, init) {
  const res = await fetch(`${BASE}${path}`, init);
  return res.status;
}

console.log(`\n=== Adversarial security probe against ${BASE} ===`);

// ---------------------------------------------------------------- CSRF
console.log('\n--- CSRF: cross-site origin must be refused ---');
{
  const body = JSON.stringify({
    email: `csrf-probe@example.invalid`,
    password: 'Test1234!pass',
    name: 'CSRF',
  });
  const hostile = await status('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: 'https://evil.example.com' },
    body,
  });
  // A browser always sends Origin on a cross-site POST, so refusing a hostile
  // origin is the CSRF boundary. 403 proves the origin allowlist is enforced.
  expectRefusal('POST /api/auth/sign-up/email with Origin: https://evil.example.com', hostile);
}

// -------------------------------------------------------- path traversal
console.log('\n--- path traversal: no filesystem disclosure ---');
{
  for (const p of [
    '/api/v1/leads/../../organizations',
    '/api/../package.json',
    '/%2e%2e/%2e%2e/package.json',
    '/api/v1/../../.env',
    '/static/../../.env',
  ]) {
    const s = await status(p);
    expectRefusal(`GET ${p}`, s);
  }
}

// ------------------------------------------------------ webhook forgery
console.log('\n--- webhook forgery: unsigned payloads must not be accepted ---');
{
  for (const p of ['/api/payments/webhook', '/api/esign/webhook']) {
    const s = await status(p, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'checkout.session.completed', event: 'completed' }),
    });
    // 503 is the correct answer when the provider is not configured: the route
    // fails CLOSED rather than processing an unverified payload.
    expectRefusal(`POST ${p} (unsigned)`, s);
  }
}

// --------------------------------------------------------------- XSS
console.log('\n--- XSS: hostile input must not be reflected unescaped ---');
{
  const payload = encodeURIComponent('<script>alert(1)</script>');
  const res = await fetch(`${BASE}/api/templates?category=${payload}`, {
    headers: { Origin: BASE },
  });
  const text = await res.text();
  checks++;
  const rawReflected = /<script>alert\(1\)<\/script>/.test(text);
  if (rawReflected) failures++;
  console.log(
    `  ${res.status} reflected raw <script>: ${rawReflected ? 'YES  <<< XSS' : 'no'}`
  );
  // The endpoint is authenticated, so 401 is also an acceptable answer.
  if (![200, 401, 403].includes(res.status)) {
    failures++;
    console.log(`      unexpected status ${res.status}`);
  }
}

// ------------------------------------------------------ open redirect
console.log('\n--- open redirect: external destinations must be refused ---');
{
  for (const p of [
    '/api/auth/callback/github?callbackUrl=https://evil.example.com',
    '/account/signin?callbackUrl=https://evil.example.com',
    '/?redirect=https://evil.example.com',
  ]) {
    const res = await fetch(`${BASE}${p}`, { redirect: 'manual' });
    const loc = res.headers.get('location') || '';
    checks++;
    const external = /^https?:\/\/(?!localhost|127\.0\.0\.1)/i.test(loc);
    if (external) failures++;
    console.log(
      `  ${res.status} ${p}${loc ? ` -> ${loc.slice(0, 60)}` : ''}${
        external ? '   <<< EXTERNAL REDIRECT' : ''
      }`
    );
  }
}

// --------------------------------------------------- security headers
console.log('\n--- security headers present on a public response ---');
{
  const res = await fetch(`${BASE}/`);
  const need = [
    'content-security-policy',
    'x-content-type-options',
    'x-frame-options',
    'referrer-policy',
  ];
  for (const h of need) {
    checks++;
    const present = res.headers.get(h) !== null;
    if (!present) failures++;
    console.log(`  ${present ? 'OK  ' : 'MISS'} ${h}`);
  }
}

console.log(`\nRESULT: ${checks} checks, ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
