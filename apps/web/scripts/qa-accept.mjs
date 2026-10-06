/**
 * QA-ACCEPT — establish the legal-acceptance state for the controlled QA
 * account so page-level browser QA is not trapped at `/legal/accept`.
 *
 * WHY THIS EXISTS
 * ---------------
 * The `enforceAccessGate` middleware holds any authenticated, role-allowed user
 * who lacks CURRENT-version `terms` + `privacy` rows in `legal_acceptances` at
 * `/legal/accept`. A QA account created by the scripts never accepted, so every
 * page route redirected there and page-level QA could not run at all. Previous
 * sessions recorded this as a "test-account gap" and moved on.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It does not bypass, weaken or short-circuit the gate:
 *   * it does NOT delete or edit the middleware redirect,
 *   * it does NOT write to `legal_acceptances` directly,
 *   * it does NOT disable an acceptance check,
 *   * it does NOT hardcode a version.
 *
 * It performs the EXACT flow a legitimate user performs: it signs in and calls
 * `POST /api/legal` with `{ keys: ['tos','privacy'] }`. That route derives
 * `user_id`, IP and user-agent from the session server-side and writes the
 * version from the legal markdown source, so the resulting evidence rows are
 * indistinguishable from a real acceptance.
 *
 * PRECONDITIONS
 * -------------
 *   * A QA account exists, and its credentials are available OUTSIDE the repo.
 *   * Set `QA_EMAIL` and `QA_PASSWORD` in the environment, or point `QA_CRED_FILE`
 *     at a JSON file with `{ "email", "password", "base" }` (default: the
 *     OS temp dir's `qa-cred.json`). NO credential is stored in this repository.
 *   * `QA_BASE` (or `base` in the cred file) selects the target origin.
 *
 * EXPECTED RESULT
 * ---------------
 *   1. Before: a page route such as `/dashboard` redirects (307/302) to
 *      `/legal/accept`.
 *   2. After:  `POST /api/legal` returns `{ success: true, accepted: [...] }`.
 *   3. After:  `/dashboard` returns 200 and is NOT a redirect to
 *      `/legal/accept`.
 *   4. Persistence: after a fresh sign-in, `/dashboard` is still 200.
 *
 * CLEANUP
 * -------
 * Acceptance is permanent evidence of consent, so this script does NOT undo it.
 * Acceptance is only re-required when the legal document versions are bumped,
 * which is the intended re-consent behaviour.
 *
 * USAGE
 * -----
 *   node scripts/qa-accept.mjs                      # uses env + default cred file
 *   QA_BASE=https://dealswift-loadtest.<acct>.workers.dev node scripts/qa-accept.mjs
 *
 * Exit codes: 0 = already accepted or acceptance established;
 *             1 = acceptance failed / still redirected afterwards;
 *             2 = missing preconditions (credentials).
 */
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function loadCredentials() {
  const credFile = process.env.QA_CRED_FILE || join(tmpdir(), 'qa-cred.json');
  let fromFile = {};
  try {
    fromFile = JSON.parse(readFileSync(credFile, 'utf8'));
  } catch {
    // No file is fine when both env vars are present.
  }

  const email = process.env.QA_EMAIL || fromFile.email;
  const password = process.env.QA_PASSWORD || fromFile.password;
  const base = (process.env.QA_BASE || fromFile.base || '').replace(/\/+$/, '');

  if (!email || !password || !base) {
    console.error(
      'Missing preconditions. Set QA_EMAIL and QA_PASSWORD, or provide QA_CRED_FILE ' +
        '(default: <temp>/qa-cred.json) containing { email, password, base }.',
    );
    console.error('No credentials belong in this repository.');
    process.exit(2);
  }
  return { email, password, base };
}

/** Maintain a cookie jar across fetches, as a browser would. */
function createJar() {
  const jar = new Map();
  return {
    absorb(response) {
      const raw = typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [response.headers.get('set-cookie')].filter(Boolean);
      for (const line of raw) {
        const [pair] = String(line).split(';');
        const idx = pair.indexOf('=');
        if (idx > 0) {
          const name = pair.slice(0, idx).trim();
          const value = pair.slice(idx + 1).trim();
          if (value === '' || /expires=thu, 01 jan 1970/i.test(line)) jar.delete(name);
          else jar.set(name, value);
        }
      }
    },
    header() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
  };
}

async function main() {
  const { email, password, base } = loadCredentials();
  const jar = createJar();

  const request = async (path, init = {}) => {
    const cookie = jar.header();
    const res = await fetch(base + path, {
      ...init,
      redirect: 'manual',
      headers: {
        ...(init.headers || {}),
        origin: base,
        ...(cookie ? { cookie } : {}),
      },
    });
    jar.absorb(res);
    return res;
  };

  console.log(`target = ${base}`);
  console.log(`account = ${email}`);

  // 1. Sign in the way the sign-in form does.
  const signin = await request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!signin.ok) {
    console.error(`FAIL sign-in: ${signin.status} ${await signin.text().catch(() => '')}`);
    process.exit(1);
  }
  console.log(`sign-in: ${signin.status}`);

  // 2. Observe the gate BEFORE accepting, so the run proves the gate was real.
  const before = await request('/dashboard');
  const gatedBefore = before.status >= 300 && before.status < 400;
  const gateLocation = before.headers.get('location') || '';
  console.log(
    `before: /dashboard -> ${before.status}` +
      (gatedBefore ? ` (redirect to ${gateLocation})` : ' (not gated)'),
  );

  if (!gatedBefore) {
    console.log('Account is not held at the acceptance gate — nothing to do.');
    console.log('RESULT: ALREADY_ACCEPTED');
    return;
  }
  if (!gateLocation.includes('/legal/accept')) {
    // A different gate (ban / pending-access / domain) is responsible. Do not
    // touch acceptance state when the blocker is something else entirely.
    console.error(
      `Account is redirected to ${gateLocation}, which is NOT the legal gate. ` +
        'Refusing to record acceptance for an unrelated blocker.',
    );
    process.exit(1);
  }

  // 3. The legitimate flow: record acceptance through the real endpoint.
  const accept = await request('/api/legal', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ keys: ['tos', 'privacy'] }),
  });
  const acceptBody = await accept.text().catch(() => '');
  console.log(`POST /api/legal -> ${accept.status} ${acceptBody.slice(0, 160)}`);
  if (!accept.ok) {
    console.error('FAIL: acceptance endpoint rejected the request.');
    process.exit(1);
  }

  // 4. The gate must now be open. The middleware re-evaluates per request, so a
  //    fresh request is the honest test (no cache, no client-side patch).
  const after = await request('/dashboard');
  const stillGated = after.status >= 300 && after.status < 400;
  console.log(`after: /dashboard -> ${after.status}`);

  if (stillGated) {
    console.error(
      `FAIL: still redirected to ${after.headers.get('location')} after accepting. ` +
        'This means the recorded version does not satisfy the gate — check that ' +
        'REQUIRED_ACCEPTANCE_VERSIONS matches the legal markdown frontmatter ' +
        '(src/lib/legal.test.ts guards this).',
    );
    process.exit(1);
  }

  // 5. Persistence across a fresh session.
  await request('/api/auth/sign-out', { method: 'POST' });
  const resign = await request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!resign.ok) {
    console.error(`FAIL: could not re-authenticate (${resign.status}).`);
    process.exit(1);
  }
  const persisted = await request('/dashboard');
  const persistedGated = persisted.status >= 300 && persisted.status < 400;
  console.log(`after re-login: /dashboard -> ${persisted.status}`);

  if (persistedGated) {
    console.error('FAIL: acceptance did not persist across sign-out / sign-in.');
    process.exit(1);
  }

  console.log('RESULT: ACCEPTED_AND_PERSISTED');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});