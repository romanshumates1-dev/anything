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

const BASE = process.env.QA_BASE || 'https://dealswiftautomation.com';
const EMAIL = process.env.QA_EMAIL || '';
const PASSWORD = process.env.QA_PASSWORD || '';

if (!EMAIL || !PASSWORD) {
  console.error('QA_EMAIL / QA_PASSWORD required');
  process.exit(2);
}

const ROUTES = ['/dashboard', '/campaigns', '/lead-finder', '/settings/billing'];
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
for (const route of ROUTES) {
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

  results.push({
    route,
    status,
    finalUrl: page.url(),
    errorBoundary,
    navError: error,
    consoleErrors: bucket.consoleErrors,
    pageErrors: bucket.pageErrors,
    failedRequests: bucket.failedRequests,
  });

  console.log(
    `${route} -> status=${status} boundary=${errorBoundary} ` +
      `console=${bucket.consoleErrors.length} pageErr=${bucket.pageErrors.length} ` +
      `failedReq=${bucket.failedRequests.length}${error ? ` navError=${error}` : ''}`,
  );
}

await browser.close();

const noisy = results.filter(
  (r) => r.errorBoundary || r.pageErrors.length || r.consoleErrors.length || r.failedRequests.length || r.error,
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
}