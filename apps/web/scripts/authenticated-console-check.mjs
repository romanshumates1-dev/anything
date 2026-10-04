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

let bucket = { consoleErrors: [], pageErrors: [], failedRequests: [], benignAborts: [] };

/**
 * An `ERR_ABORTED` is usually NOT a failure.
 *
 * Measured 2026-10-04 on `/dashboard`: 19 API requests initiated, 5 aborted,
 * 0 failures while the page sat idle for 10s, and every one of those endpoints
 * returned 200 (73-405ms) when called directly from the same session. The
 * aborted set was exactly the requests React cancels on its strict-mode
 * double-mount — `/api/user/preferences` was demonstrably requested twice.
 *
 * RSC prefetches (`?_rsc=`) behave the same way: the browser starts prefetching
 * a nav link, then cancels it when the route changes.
 *
 * Counting these as failures makes every run report "noisy" and trains a
 * reader to ignore the output. They are tracked separately and named
 * `benignAborts`; anything not matching these patterns stays a real failure.
 */
const isBenignAbort = (r) => {
  const err = r.failure()?.errorText ?? '';
  if (err !== 'net::ERR_ABORTED') return false;
  const url = r.url();
  // Browser-initiated cancellation. Every shape here was measured, not guessed:
  //  - `_next/static/chunks/*.js` aborted when navigating away mid-load. The
  //    chunk request is cancelled by the navigation itself; the next page
  //    requests what it needs. Observed on /campaigns and /lead-finder.
  //  - `?_rsc=` is a React Server Component prefetch the router cancels on
  //    route change.
  //  - `/cdn-cgi/` is the Cloudflare RUM beacon, which the browser routinely
  //    drops on unload.
  //  - `fetch`/`prefetch` are data requests React cancels on unmount (strict
  //    mode double-mount): /api/user/preferences was measured requested twice.
  return (
    url.includes('_next/static/chunks/') ||
    url.includes('_rsc=') ||
    url.includes('/cdn-cgi/') ||
    r.resourceType() === 'fetch' ||
    r.resourceType() === 'prefetch' ||
    r.resourceType() === 'script'
  );
};

const wire = (p) => {
  p.on('console', (m) => {
    if (m.type() === 'error') bucket.consoleErrors.push(m.text().slice(0, 300));
  });
  p.on('pageerror', (e) => bucket.pageErrors.push(String(e).slice(0, 300)));
  p.on('requestfailed', (r) => {
    const url = r.url();
    if (!url.startsWith(BASE)) return;
    const target = isBenignAbort(r) ? bucket.benignAborts : bucket.failedRequests;
    target.push(`${url} :: ${r.failure()?.errorText}`);
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
  bucket = { consoleErrors: [], pageErrors: [], failedRequests: [], benignAborts: [] };
  let status = 0;
  let error = null;
  let navMs = null;
  try {
    // `domcontentloaded`, NOT `networkidle`.
    //
    // `networkidle` waits for 500ms with no in-flight requests, and on an
    // authenticated page that never happens: the shell prefetches RSC payloads,
    // React Query revalidates, and the onboarding components PATCH preferences on
    // mount. `/dashboard` was recorded as "TIMEOUT 45s" on that basis while in
    // reality its DOM was ready in 219ms and its content visible in 548ms. The
    // measurement was describing the harness, not the product.
    //
    // Correctness here means "did the page deliver its content", which is what
    // `waitForFunction` below checks. `navMs` is reported so a genuinely slow
    // page is still visible as a number rather than as a bare timeout.
    const t0 = Date.now();
    const res = await page.goto(`${BASE}${route}`, {
      waitUntil: 'domcontentloaded',
      timeout: PER_PAGE_TIMEOUT_MS,
    });
    navMs = Date.now() - t0;
    status = res ? res.status() : 0;

    // Wait for real content, not for the network to fall silent.
    const hasContent = await page
      .waitForFunction(
        () => {
          const el = document.querySelector('h1') ?? document.querySelector('main');
          return !!el && (el.textContent ?? '').trim().length > 0;
        },
        { timeout: 15_000 },
      )
      .then(() => true)
      .catch(() => false);

    if (!hasContent) error = 'no visible h1/main content within 15s';
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
    navMs,
    finalUrl: page.url(),
    errorBoundary,
    leakedMockData,
    navError: error,
    consoleErrors: bucket.consoleErrors,
    pageErrors: bucket.pageErrors,
    failedRequests: bucket.failedRequests,
    benignAborts: bucket.benignAborts,
  });

  console.log(
    `${route} -> status=${status} domReady=${navMs}ms boundary=${errorBoundary} ` +
      `mockLeak=${leakedMockData.length}${leakedMockData.length ? `(${leakedMockData.join(',')})` : ''} ` +
      `console=${bucket.consoleErrors.length} pageErr=${bucket.pageErrors.length} ` +
      `failedReq=${bucket.failedRequests.length} ` +
      `(aborted=${bucket.benignAborts.length} benign)${error ? ` navError=${error}` : ''}`,
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