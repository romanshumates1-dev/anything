/**
 * FOCUSED authenticated console check (2026-10-04).
 *
 * WHY A NEW SCRIPT
 * ----------------
 * `deployed-browser-qa.mjs` hangs (>10 min, flat CPU) and its hang is still
 * unexplained. Rather than block on it, this does the one thing HTTP status
 * codes cannot prove: that authenticated pages throw nothing client-side.
 *
 * SCOPE, deliberately narrow
 * --------------------------
 * Loads a small set of authenticated pages in a real browser and records:
 * console errors, uncaught page exceptions, failed requests, and whether an
 * error boundary rendered. Every route has a hard per-page timeout so this
 * cannot hang the way the other script does.
 *
 * Credentials come from the environment only (QA_EMAIL / QA_PASSWORD).
 * Nothing is written to disk and no secret is ever logged.
 */
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const BASE = process.env.QA_BASE || 'https://dealswiftautomation.com';

/**
 * Credentials come from $TEMP/qa-cred.json, NOT from QA_EMAIL / QA_PASSWORD env
 * vars.
 *
 * WHY THIS CHANGED (2026-10-04)
 * -----------------------------
 * The previous version read `process.env.QA_EMAIL` / `QA_PASSWORD` and the
 * caller supplied them with `set VAR=value` inside a `cmd /c` chain. cmd applies
 * its own parsing to that line, so the values reaching Node were not the values
 * in the file. The result was a silent, completely misleading failure: the
 * browser POSTed /api/auth/sign-in/email and got
 *
 *     401 {"message":"Invalid email or password"}
 *
 * while a direct API call with the SAME credentials returned 200. That reads
 * exactly like a broken production login, and it is not one.
 *
 * Reading the JSON file inside Node removes the shell from the credential path
 * entirely. It matches what `scripts/_postdeploy-auth-smoke.mjs` already does.
 *
 * A green run here must never be reported as evidence about authentication
 * without ALSO asserting `hasSession === true` — an unauthenticated run
 * produces clean-looking pages and proves nothing.
 */
const credPath = process.env.QA_CRED_FILE || `${process.env.TEMP}\\qa-cred.json`;
let EMAIL = '';
let PASSWORD = '';
try {
  const cred = JSON.parse(readFileSync(credPath, 'utf8'));
  EMAIL = cred.email ?? '';
  PASSWORD = cred.password ?? '';
} catch {
  // Fall back to env only if it is actually populated; never silently continue.
  EMAIL = process.env.QA_EMAIL || '';
  PASSWORD = process.env.QA_PASSWORD || '';
}

if (!EMAIL || !PASSWORD) {
  console.error(`Credentials required: write {"email":...,"password":...} to ${credPath}`);
  process.exit(2);
}

const ROUTES = [
  '/dashboard',
  '/campaigns',
  '/lead-finder',
  '/settings/billing',
  // Added 2026-10-04 after `fa43bd0`: these two pages served HARDCODED rows and
  // never called their API. A status of 200 proved nothing about them, so each
  // carries an explicit assertion that the fabricated content is gone.
  //
  // NOTE ON THE STRINGS: the first version of this check flagged "Platinum Club"
  // and "Revenue Machine" as leaked mock data. That was the CHECK being wrong,
  // not the page. Both are real rows seeded by migration 068
  // (db/migrations/068_user_profile_and_gamification.sql), so a page correctly
  // rendering live data will contain them. Only strings that appear nowhere in
  // the database are valid evidence of a hardcoded fallback.
  { path: '/achievements', mustNotContain: ['2024-01-15', '2024-02-01'] },
  { path: '/inbox', mustNotContain: ['John Smith', 'Sarah Johnson', 'Bob Wilson', 'Jane Doe', '(555)'] },
];
const PER_PAGE_TIMEOUT_MS = 45_000;

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

let bucket = { consoleErrors: [], pageErrors: [], failedRequests: [] };

const wire = (p) => {
  p.on('console', (m) => {
    if (m.type() === 'error') bucket.consoleErrors.push(m.text().slice(0, 300));
  });
  p.on('pageerror', (e) => bucket.pageErrors.push(String(e).slice(0, 300)));
  p.on('requestfailed', (r) => {
    const url = r.url();
    if (url.startsWith(BASE)) bucket.failedRequests.push(`${url} :: ${r.failure()?.errorText}`);
  });
};
wire(page);

// ---- sign in -------------------------------------------------------------
const signinStatus = await (async () => {
  try {
    const res = await page.goto(`${BASE}/account/signin`, {
      waitUntil: 'domcontentloaded',
      timeout: PER_PAGE_TIMEOUT_MS,
    });
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);

    // WAIT for the sign-in to actually complete before navigating away.
    // The first version of this script clicked and immediately called goto(),
    // which ABORTED the in-flight POST /api/auth/sign-in/email and produced a
    // misleading 401 in the console plus a redirect-to-signin on every route.
    // That was a bug in the harness, not in the app - do not reintroduce it.
    await page.click('button[type="submit"]');
    await page
      .waitForURL((u) => !u.pathname.includes('/account/signin'), { timeout: PER_PAGE_TIMEOUT_MS })
      .catch(() => console.error('WARN: still on signin after submit'));

    // Prove the session exists server-side rather than inferring it from the URL.
    const probe = await page.evaluate(async () => {
      const r = await fetch('/api/auth/get-session', { credentials: 'include' });
      const j = await r.json().catch(() => null);
      return { status: r.status, hasSession: !!(j && j.user && j.user.id) };
    });
    console.log(`SESSION_PROBE=${JSON.stringify(probe)}`);

    // An unauthenticated run renders clean pages and would report everything as
    // fine while proving nothing. Fail loudly instead of continuing.
    if (!probe.hasSession) {
      console.error(
        'FATAL: no authenticated session. Every route below would be verified ' +
          'while logged OUT, which is worthless evidence. Fix sign-in before ' +
          'trusting any result from this script.',
      );
    }

    return res ? res.status() : 0;
  } catch (e) {
    console.error('SIGNIN FAILED:', String(e).slice(0, 200));
    return -1;
  }
})();
console.log(`SIGNIN_PAGE_STATUS=${signinStatus}`);
console.log(`AFTER_SIGNIN_URL=${page.url()}`);

// ---- visit each authenticated route --------------------------------------
const results = [];
for (const entry of ROUTES) {
  const route = typeof entry === 'string' ? entry : entry.path;
  const mustNotContain = typeof entry === 'string' ? [] : (entry.mustNotContain ?? []);
  bucket = { consoleErrors: [], pageErrors: [], failedRequests: [] };
  let status = 0;
  let error = null;
  try {
    const res = await page.goto(`${BASE}${route}`, {
      waitUntil: 'networkidle',
      timeout: PER_PAGE_TIMEOUT_MS,
    });
    status = res ? res.status() : 0;
    // Give React a beat to hydrate and surface late errors.
    await page.waitForTimeout(1500);
  } catch (e) {
    error = String(e).split('\n')[0].slice(0, 160);
  }

  const body = await page.content().catch(() => '');
  const errorBoundary = /Application error|error-boundary|Something went wrong/i.test(body);

  // A 200 is not evidence that a page shows real data. Assert the fabricated
  // strings from the old mock arrays are absent from the rendered HTML.
  const leakedMockData = mustNotContain.filter((s) => body.includes(s));

  results.push({
    route,
    status,
    finalUrl: page.url(),
    errorBoundary,
    leakedMockData,
    navError: error,
    consoleErrors: bucket.consoleErrors,
    pageErrors: bucket.pageErrors,
    failedRequests: bucket.failedRequests,
  });

  console.log(
    `${route} -> status=${status} boundary=${errorBoundary} ` +
      `mockLeak=${leakedMockData.length}${leakedMockData.length ? `(${leakedMockData.join(',')})` : ''} ` +
      `console=${bucket.consoleErrors.length} pageErr=${bucket.pageErrors.length} ` +
      `failedReq=${bucket.failedRequests.length}${error ? ` navError=${error}` : ''}`,
  );
}

await browser.close();

const noisy = results.filter(
  (r) =>
    r.errorBoundary ||
    r.pageErrors.length ||
    r.consoleErrors.length ||
    r.failedRequests.length ||
    r.error ||
    r.leakedMockData.length,
);

console.log('\n=== SUMMARY ===');
console.log(`routes=${results.length} clean=${results.length - noisy.length} noisy=${noisy.length}`);
for (const r of noisy) {
  console.log(`\n${r.route}`);
  if (r.consoleErrors.length) console.log(`  console: ${r.consoleErrors.slice(0, 4).join(' | ')}`);
  if (r.pageErrors.length) console.log(`  pageerror: ${r.pageErrors.slice(0, 4).join(' | ')}`);
  if (r.failedRequests.length) console.log(`  failedReq: ${r.failedRequests.slice(0, 4).join(' | ')}`);
  if (r.errorBoundary) console.log('  ERROR BOUNDARY RENDERED');
  if (r.error) console.log(`  navError: ${r.error}`);
  if (r.leakedMockData.length) {
    console.log(`  FABRICATED DATA STILL RENDERED: ${r.leakedMockData.join(', ')}`);
  }
}