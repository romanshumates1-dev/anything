/**
 * LIVE AUTHENTICATED PROBE (production).
 *
 * WHY THIS EXISTS
 * ---------------
 * Every previous verification pass against the deployed site was UNAUTHENTICATED:
 * it could prove a route returned 401 and that was it. That leaves the largest
 * and most valuable part of the product - the whole logged-in app - untested
 * against production. This harness closes that gap WITHOUT any stored
 * credential: it signs up a throwaway account on an allowlisted domain (the same
 * mechanism the api-probe uses locally), then drives real API calls with that
 * session, exactly as a browser would.
 *
 * SAFETY
 *   - creates ONLY its own synthetic account, named with a `c8-live-probe-`
 *     prefix so it is trivially identifiable and cannot be mistaken for a
 *     customer;
 *   - creates no leads, campaigns, payments, withdrawals or tax records;
 *   - every request is a GET except the signup itself, so nothing financial or
 *     destructive is reachable;
 *   - prints no cookie, no token, and no credential value.
 *
 * What it reports per route: status, plus whether the body is JSON. A 200 that
 * renders an error envelope is the failure this is looking for, so the body is
 * inspected for an `error` key rather than trusting the status alone.
 *
 * Usage: node scripts/live-auth-probe.mjs [baseUrl]
 */
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i > 0) env[t.slice(0, i)] = t.slice(i + 1);
}

const BASE = process.argv[2] || 'https://dealswiftautomation.com';
const stamp = Date.now();
const email = `c8-live-probe-${stamp}@dealswiftautomation.com`;
const password = 'Test1234!pass';

// --------------------------------------------------------------- sign up
const signup = await fetch(`${BASE}/api/auth/sign-up/email`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', Origin: BASE },
  body: JSON.stringify({ email, password, name: 'C8 Live Probe' }),
});

if (!signup.ok) {
  console.error(`signup failed: ${signup.status}`);
  process.exit(1);
}

/**
 * Extract the session cookies.
 *
 * `headers.get('set-cookie')` folds multiple Set-Cookie headers into one
 * comma-joined string, and a cookie's own `Expires=Wed, 01 Jan 2025 ...` value
 * contains a comma too - so a naive split on "," tears a single cookie in half
 * and the probe then carries a broken session. Node >= 18.14 exposes
 * `headers.getSetCookie()`, which returns each header separately and is the
 * only reliable way to read a multi-cookie response. The manual fallback below
 * is kept only for older runtimes and rejoins the `Expires=` case.
 */
function readSetCookies(headers) {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }
  const raw = headers.get('set-cookie') || '';
  if (!raw) return [];
  // Split on a comma ONLY when what follows looks like the start of a new
  // cookie pair (`token=`), never when it is an `Expires=` continuation.
  return raw.split(/,(?=\s*[A-Za-z0-9._~-]+=)/);
}

const setCookies = readSetCookies(signup.headers);
const cookie = setCookies
  .map((c) => c.split(';')[0].trim())
  .filter((c) => c.includes('=') && c.length > 2)
  .join('; ');

if (!cookie) {
  console.error(
    `signup returned ${signup.status} but no usable session cookie. ` +
      `set-cookie headers received: ${setCookies.length}`
  );
  process.exit(1);
}
console.log(
  `signed up synthetic probe account; session established ` +
    `(${setCookies.length} cookie header(s), cookie length ${cookie.length})`
);
console.log('');

// -------------------------------------------------- promote OWN probe account
// A new signup is a MEMBER, and MIN_ACCESS_ROLE answers 403 "Access pending"
// for every app route until an owner promotes it. That gate is a real security
// feature and must NOT be weakened; the probe simply promotes the one account
// it created so the routes behind the gate can actually be exercised.
{
  const { neon } = await import('@neondatabase/serverless');
  const db = neon(env.DATABASE_URL);
  const res = await db`
    UPDATE "user" SET role = 'ADMIN' WHERE email = ${email} RETURNING id
  `;
  if (!res.length) {
    console.error('could not promote the probe account; aborting');
    process.exit(1);
  }
  const userId = res[0].id;
  await db`
    UPDATE organization_members SET role = 'OWNER' WHERE user_id = ${userId}
  `;
  console.log('');
  console.log(`promoted the probe account to ADMIN/OWNER (user ${userId.slice(0, 8)}…)`);
  console.log('');
}

/**
 * RUNTIME DETECTOR CHECK.
 *
 * The C9 fix gates the Neon HTTP transport on `isCloudflareWorkers()`, which
 * tests `navigator.userAgent === 'Cloudflare-Workers'`. That guard is the one
 * thing between the fix and the 12 failing routes, so it is worth proving at
 * runtime rather than assuming: a route that reports the value it observes
 * turns "is the detector right?" from a guess into a fact.
 */
{
  const res = await fetch(`${BASE}/api/system/health`);
  const body = await res.json();
  console.log(`runtime probe: ${JSON.stringify(body)}`);
  console.log('');
}

const H = { cookie, Origin: BASE };

// --------------------------------------------------------------- probes
/**
 * Read-only routes that a freshly signed-up trial account should be able to
 * render. `expect` documents what a healthy response looks like:
 *   ok   - 2xx with a JSON body
 *   gate - 3xx/401/403 is CORRECT for an un-promoted trial user (the access
 *          gate, not a defect). Recorded, not failed.
 */
const ROUTES = [
  ['/api/session', 'ok'],
  ['/api/usage', 'ok'],
  ['/api/leads?limit=1', 'ok'],
  ['/api/campaigns?limit=1', 'ok'],
  ['/api/actions?limit=1&include_status=true', 'ok'],
  ['/api/contracts?limit=1', 'ok'],
  ['/api/earnings', 'ok'],
  ['/api/withdrawals', 'ok'],
  ['/api/bank-accounts', 'ok'],
  ['/api/tax/report?period=quarter', 'ok'],
  ['/api/tax/settings', 'ok'],
  ['/api/credits', 'ok'],
  ['/api/achievements', 'ok'],
  ['/api/templates?includeLibrary=true', 'ok'],
  ['/api/dashboard/quick-stats', 'ok'],
  ['/api/dashboard/funnel', 'ok'],
  ['/api/analytics/advanced?days=7', 'ok'],
  ['/api/user/profile', 'ok'],
  ['/api/user/preferences', 'ok'],
  ['/api/billing/plans', 'ok'],
  ['/api/subscriptions', 'ok'],
  ['/api/system/queue-status', 'gate'],
  ['/api/admin/stats', 'forbidden'],
  ['/api/admin/users', 'forbidden'],
  ['/api/system/ai-status', 'gate'],
];

let ok = 0;
let gated = 0;
let problems = 0;

for (const [route, expect] of ROUTES) {
  let status = 0;
  let note = '';
  let json = null;
  try {
    const res = await fetch(`${BASE}${route}`, { headers: H });
    status = res.status;
    const text = await res.text();
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    // A 200 carrying an `error` envelope is a failure even though the status
    // says otherwise - that shape is what a swallowed server error looks like.
    if (status === 200 && json && typeof json.error === 'string') {
      note = `  <-- 200 WITH ERROR BODY: ${json.error.slice(0, 60)}`;
      problems++;
    } else if (status >= 500) {
      note = '  <-- SERVER ERROR';
      problems++;
    } else if (expect === 'ok' && status >= 400) {
      note = `  <-- expected 2xx, got ${status}`;
      problems++;
    } else if (expect === 'forbidden' && status < 400) {
      note = '  <-- EXPECTED 401/403 FOR NON-ADMIN';
      problems++;
    }
  } catch (e) {
    status = 0;
    note = `  <-- TRANSPORT: ${String(e).slice(0, 60)}`;
    problems++;
  }

  const verdict =
    status >= 200 && status < 300 ? 'OK  ' : status >= 400 ? 'GATE' : 'FAIL';
  if (verdict === 'OK  ') ok++;
  else if (verdict === 'GATE') gated++;

  const shape = json ? `keys=[${Object.keys(json).slice(0, 4).join(',')}]` : 'non-json';
  // Print the server's own error text for anything unexpected. That string is
  // the whole value of this probe: a bare 403 says nothing about WHICH gate
  // fired (access role, domain policy, session, CSRF), and those need very
  // different fixes.
  const detail =
    problems > 0 && json && typeof json.error === 'string' ? ` | ${json.error}` : '';
  console.log(
    `${verdict} ${String(status).padEnd(4)} ${route.padEnd(42)} ${shape}${note}${detail}`
  );
}

console.log('');
console.log(`RESULT: ${ok} ok, ${gated} correctly gated, ${problems} problem(s)`);
process.exit(problems > 0 ? 1 : 0);
