/**
 * DEPLOYED AUTHENTICATED BROWSER QA — against the real production domain.
 *
 * WHY THIS EXISTS AS A SCRIPT AND NOT A ONE-OFF
 * ----------------------------------------------
 * The requirements matrix lists authenticated browser verification as the
 * highest-value UNBLOCKED item, and the previous defect it would have caught
 * (GET /api/auth/get-session 500 -> GET / 500) was only ever visible in a real
 * browser. A one-off manual pass produces evidence that cannot be re-run; this
 * file makes the pass reproducible and therefore auditable.
 *
 * WHAT IT MEASURES, PER ROUTE
 * --------------------------
 *   - wall-clock navigation time (DOMContentLoaded, load, network idle)
 *   - server-timing split when the Worker emits it (next.js / proxy / app code)
 *   - console errors and uncaught page exceptions
 *   - failed requests and their reasons
 *   - hydration failures, which surface as console errors, not HTTP codes
 *   - the document's HTTP status
 *   - whether an error boundary rendered, which a 200 status alone would miss
 *
 * HONEST LIMITS
 * -------------
 * A route that redirects to sign-in is recorded as REDIRECTED, never as a pass.
 * That distinction is the difference between "the page works" and "you were
 * bounced to the login screen"; collapsing them is how a broken authenticated
 * app gets reported as healthy.
 *
 * Usage:
 *   QA_EMAIL=... QA_PASSWORD=... node scripts/deployed-browser-qa.mjs
 *   QA_BASE=https://dealswiftautomation.com node scripts/deployed-browser-qa.mjs
 */
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

const BASE = process.env.QA_BASE || 'https://dealswiftautomation.com';
const EMAIL = process.env.QA_EMAIL || '';
const PASSWORD = process.env.QA_PASSWORD || '';

/**
 * Edge rather than a downloaded Chromium: this environment's Playwright CDN
 * download is TLS-intercepted (`bad record mac`) and the system drive is out of
 * disk space, but Edge is installed. It is the same engine Playwright drives
 * natively, so navigation, network and console capture are equivalent.
 */
const EDGE_PATHS = [
  process.env.EDGE_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);

function edgePath() {
  const found = EDGE_PATHS.find((p) => existsSync(p));
  if (!found) throw new Error(`No Edge executable found. Tried: ${EDGE_PATHS.join(', ')}`);
  return found;
}

/** Public routes a visitor reaches without an account. */
const PUBLIC_ROUTES = [
  '/', '/pricing', '/features', '/trust', '/faq', '/how-it-works', '/contact',
  '/legal/terms', '/legal/privacy', '/legal/refunds', '/legal/cookies', '/compliance',
  '/account/signin', '/account/signup', '/account/forgot-password',
];

/** Authenticated routes, crawled after a real sign-in. */
const AUTH_ROUTES = [
  '/dashboard', '/campaigns', '/campaigns/new', '/contacts', '/lead-finder',
  '/crm', '/contracts', '/billing', '/payouts', '/earnings', '/settings',
  '/analytics', '/achievements', '/leaderboard',
];

function attachCollectors(page) {
  const state = { consoleErrors: [], pageErrors: [], failedRequests: [] };
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // A missing favicon is noise, not a hydration or render failure.
    if (/favicon/i.test(text)) return;
    state.consoleErrors.push(text.slice(0, 300));
  });
  page.on('pageerror', (err) => {
    state.pageErrors.push(String(err?.message ?? err).slice(0, 300));
  });
  page.on('requestfailed', (req) => {
    state.failedRequests.push({
      url: req.url().slice(0, 160),
      reason: req.failure()?.errorText ?? 'unknown',
    });
  });
  return state;
}

/**
 * Visit one route and collect everything observable about it.
 *
 * Each wait has its own bounded timeout and is allowed to expire: a third-party
 * script that never settles must not be able to hang the whole crawl, and a slow
 * tail is recorded as a slow `elapsedMs` rather than silently dropped.
 */
async function visit(page, route, viewport) {
  const state = attachCollectors(page);
  const url = `${BASE}${route}`;
  const started = Date.now();
  let status = null;
  let serverTiming = null;
  let loadError = null;

  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    status = response ? response.status() : null;
    serverTiming = response ? response.headers()['server-timing'] ?? null : null;
    await page.waitForLoadState('load', { timeout: 20000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
  } catch (err) {
    loadError = String(err?.message ?? err).slice(0, 200);
  }
  const elapsedMs = Date.now() - started;

  const finalUrl = page.url();
  const redirected = finalUrl !== url && /\/account\/signin/.test(finalUrl);

  const bodyText = (await page.locator('body').innerText().catch(() => '')) ?? '';
  const renderedError =
    /Application error|Internal Server Error|unknown error occurred|This page could not be found|Worker exceeded resource limits/i.test(
      bodyText,
    );
  const hydrationError = state.consoleErrors.some((t) =>
    /hydrat|did not match|Minified React error #(418|423|425)/i.test(t),
  );

  return {
    route,
    viewport,
    status,
    elapsedMs,
    serverTiming,
    redirected,
    renderedError,
    hydrationError,
    consoleErrors: state.consoleErrors,
    pageErrors: state.pageErrors,
    failedRequests: state.failedRequests,
    loadError,
    finalUrl: finalUrl.replace(BASE, '') || '/',
  };
}

/** Drive the real sign-in form; no assumed selectors beyond type/name. */
async function login(page) {
  await page.goto(`${BASE}/account/signin`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.locator('input[type="email"], input[name="email"]').first().waitFor({
    state: 'visible',
    timeout: 20000,
  });
  await page.locator('input[type="email"], input[name="email"]').first().fill(EMAIL);
  await page.locator('input[type="password"], input[name="password"]').first().fill(PASSWORD);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  return !/account\/signin/.test(page.url());
}

async function main() {
  const browser = await chromium.launch({
    executablePath: edgePath(),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const results = {
    base: BASE,
    startedAt: new Date().toISOString(),
    public: [],
    auth: [],
    mobile: [],
    authFlow: null,
  };

  // ---------- 1. PUBLIC, desktop ----------
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  for (const r of PUBLIC_ROUTES) {
    results.public.push(await visit(page, r, 'desktop-1440'));
  }

  // ---------- 2. AUTH FLOW ----------
  if (EMAIL && PASSWORD) {
    results.authFlow = { attempted: true, email: EMAIL };
    try {
      results.authFlow.succeeded = await login(page);
      results.authFlow.finalUrlAfterLogin = page.url().replace(BASE, '') || '/';
    } catch (err) {
      results.authFlow.error = String(err?.message ?? err).slice(0, 300);
      results.authFlow.succeeded = false;
    }
    if (results.authFlow.succeeded) {
      for (const r of AUTH_ROUTES) results.auth.push(await visit(page, r, 'desktop-1440'));
    }
  } else {
    results.authFlow = { attempted: false, reason: 'QA_EMAIL / QA_PASSWORD not supplied' };
  }

  // ---------- 3. MOBILE ----------
  const mctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  });
  const mpage = await mctx.newPage();
  for (const r of ['/', '/pricing', '/contact']) {
    results.mobile.push(await visit(mpage, r, 'mobile-390'));
  }
  if (EMAIL && PASSWORD) {
    try {
      if (await login(mpage)) {
        for (const r of ['/dashboard', '/campaigns', '/settings']) {
          results.mobile.push(await visit(mpage, r, 'mobile-390'));
        }
      }
    } catch (err) {
      results.mobile.push({
        route: '(mobile login)',
        viewport: 'mobile-390',
        loadError: String(err?.message ?? err).slice(0, 200),
      });
    }
  }

  results.finishedAt = new Date().toISOString();
  await browser.close();

  // ---------- summary ----------
  const all = [...results.public, ...results.auth, ...results.mobile];
  const bad = all.filter(
    (r) => r.renderedError || r.hydrationError || (r.status && r.status >= 500) || r.loadError,
  );
  results.summary = {
    total: all.length,
    failing: bad.length,
    failingRoutes: bad.map((r) => `${r.viewport} ${r.route} status=${r.status}`),
    slowest: [...all]
      .sort((a, b) => (b.elapsedMs ?? 0) - (a.elapsedMs ?? 0))
      .slice(0, 10)
      .map((r) => `${r.viewport} ${r.route} ${r.elapsedMs}ms status=${r.status}`),
  };

  mkdirSync('artifacts/browser-qa', { recursive: true });
  writeFileSync('artifacts/browser-qa/deployed-results.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results.summary, null, 2));
  console.log('WROTE artifacts/browser-qa/deployed-results.json');
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});