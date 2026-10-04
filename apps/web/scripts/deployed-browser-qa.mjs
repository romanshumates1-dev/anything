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

/**
 * Authenticated routes, crawled after a real sign-in.
 *
 * These are REAL app-router paths, verified against the app router's page.tsx
 * files. The list previously contained `/contacts`, `/billing` and `/earnings`,
 * none of which exist — contacts live under `/crm` and `/leads`, billing lives
 * at `/settings/billing`, and earnings are surfaced by `/reports`. Those three
 * entries returned 404 and the summary still reported "failing: 0" (see the
 * `bad` filter below), so a stale route list was indistinguishable from a
 * healthy crawl. Keep this list in sync with the app router.
 */
const AUTH_ROUTES = [
  '/dashboard', '/campaigns', '/campaigns/wizard', '/crm', '/leads', '/contracts',
  '/settings/billing', '/payouts', '/reports', '/settings', '/analytics',
  '/analytics/advanced', '/approvals', '/inbox', '/buyers', '/templates',
  '/profile', '/achievements', '/leaderboard', '/settings/accessibility',
  '/funnel', '/system-health', '/admin/users', '/admin/audit',
];

function attachCollectors(page) {
  const state = { consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [] };
  // Chrome's "Failed to load resource: the server responded with a status of
  // 403 ()" console message carries NO url, so a page emitted ~100 of them with
  // nothing to attribute them to. This listener is the only place the actual
  // endpoints surface, and without it a 403 storm is unattributable.
  page.on('response', (res) => {
    if (res.status() < 400) return;
    let path = res.url();
    try {
      path = new URL(res.url()).pathname;
    } catch {
      /* keep the raw url */
    }
    state.badResponses.push({ status: res.status(), path: path.slice(0, 160) });
  });
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
/**
 * COOLDOWN BETWEEN NAVIGATIONS — do not remove without reading why.
 *
 * The deployed Worker runs on the Cloudflare **Free plan**, where
 * `limits.cpu_ms` is rejected outright ("CPU limits are not supported for the
 * Free plan"), so the per-invocation CPU ceiling cannot be configured. It is
 * also *shared*: exhausting it returns Cloudflare error **1102** and 503s the
 * site for everyone, including logged-out visitors on `/`.
 *
 * This script originally fired ~24 routes across two viewports back-to-back
 * with no pause, each allowing 45s + 20s + 12s. That is precisely the burst
 * shape that trips the ceiling, and because a throttled response does not fail
 * fast - it consumes the whole budget - the run appeared to hang with flat CPU
 * instead of reporting failures. It was throttling itself.
 *
 * The cooldown is therefore load-bearing, not cosmetic. If a sweep trips the
 * ceiling, results become meaningless: a 503 caused by your own traffic is
 * indistinguishable from a real defect.
 */
const COOLDOWN_MS = 4_000;

/** Ceiling-trip signature, so the run aborts loudly rather than reporting 503s as defects. */
const CEILING_STATUSES = new Set([503]);

async function cooldown(reason) {
  process.stdout.write(`    (cooldown ${COOLDOWN_MS}ms after ${reason})\n`);
  await new Promise((r) => setTimeout(r, COOLDOWN_MS));
}

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

  // If we are hitting the CPU ceiling, every remaining measurement is noise
  // caused by this script. Stop and say so instead of publishing garbage.
  if (status !== null && CEILING_STATUSES.has(status)) {
    process.stderr.write(
      `\n!! ${route} returned ${status}. This sweep has tripped the shared Worker CPU\n` +
        '   ceiling, so it is about to measure its own load. Aborting.\n' +
        '   Wait ~90s, reduce ROUTES/COOLDOWN_MS, or raise the Workers plan.\n\n',
    );
    throw new Error(`aborted: ${route} returned ${status} (Worker CPU ceiling)`);
  }

  const elapsedMs = Date.now() - started;

  // Cool down between routes so the sweep stays under the ceiling.
  await cooldown(route);

  const finalUrl = page.url();
  const redirected = finalUrl !== url && /\/account\/signin/.test(finalUrl);
  // A soft redirect: the app answered 200 but served a DIFFERENT page than the
  // route under test (e.g. the role gate rendering /pending-access). This is
  // how eleven authenticated routes looked "healthy" while never being tested.
  const finalPath = (() => {
    try {
      const u = new URL(finalUrl);
      return `${u.pathname}${u.search}`;
    } catch {
      return finalUrl;
    }
  })();
  const wantedPath = (() => {
    try {
      const u = new URL(url);
      return `${u.pathname}${u.search}`;
    } catch {
      return url;
    }
  })();
  // Only meaningful when the navigation actually completed: on a timeout,
  // `finalUrl` is still the PREVIOUS page's url, which would otherwise be
  // reported as a soft redirect to a page that was never reached.
  const softRedirect = !loadError && finalPath !== wantedPath && finalPath !== '/';

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
    softRedirect,
    renderedError,
    hydrationError,
    consoleErrors: state.consoleErrors,
    pageErrors: state.pageErrors,
    failedRequests: state.failedRequests,
    // Deduplicated + capped: a single page produced ~100 identical 403 lines
    // and an unbounded list would drown the artifact.
    badResponses: Array.from(
      new Map(state.badResponses.map((b) => [`${b.status} ${b.path}`, b])).values()
    ).slice(0, 25),
    loadError,
    finalUrl: finalUrl.replace(BASE, '') || '/',
  };
}

/**
 * Complete the legal re-accept gate, the way a real user does.
 *
 * WHY THIS EXISTS: after sign-in a brand-new account is parked on
 * /legal/accept by middleware until it accepts the Terms + Privacy Policy.
 * Seventeen authenticated routes soft-redirected there, which meant the crawl
 * reported status 200 for pages it never actually loaded. Recording that as
 * "healthy" is worse than useless, so the harness walks the real form instead
 * of writing an acceptance row directly to the database: the point is to
 * exercise the gate a user actually meets.
 *
 * Returns a short status string for the artifact rather than throwing, so a
 * gate we cannot clear is reported instead of aborting the whole crawl.
 */
async function acceptLegalIfGated(page) {
  if (!/\/legal\/accept/.test(page.url())) return 'not-required';
  try {
    // Selectors learned from the real component (AcceptForm.tsx): there is NO
    // <form> element and the button has no type — it is <button onClick={accept}>
    // labelled "Accept and continue". Two earlier attempts failed here: a bare
    // `button[type="submit"]` matched the SupportChat send button (permanently
    // disabled), and scoping to a `form` matched nothing at all.
    const box = page.locator('input[type="checkbox"]').first();
    await box.waitFor({ state: 'visible', timeout: 15000 });
    await box.check();
    await page.getByRole('button', { name: /accept and continue/i }).first().click();
    // The component does a full navigation to /dashboard on success, so wait for
    // the URL to actually leave the gate rather than for networkidle alone.
    await page
      .waitForURL((u) => !/\/legal\/accept/.test(u.href), { timeout: 20000 })
      .catch(() => {});
    return /legal\/accept/.test(page.url()) ? 'attempted-but-still-gated' : 'accepted';
  } catch (err) {
    return `error: ${String(err?.message ?? err).slice(0, 160)}`;
  }
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
  // Scoped to the sign-in form for the same reason as the legal form above:
  // an unscoped `button[type="submit"]` can resolve to the SupportChat send
  // button, which is disabled and would make login appear to fail for no reason.
  const form = page
    .locator('form')
    .filter({ has: page.locator('input[type="password"], input[name="password"]') })
    .first();
  await form.locator('button[type="submit"]').first().click();
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
      results.authFlow.legalAcceptance = await acceptLegalIfGated(page);
      results.authFlow.urlAfterLegalAcceptance = page.url().replace(BASE, '') || '/';
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
        for (const r of ['/dashboard', '/campaigns', '/settings', '/settings/billing', '/payouts']) {
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
  // 4xx counts as failing. The previous filter only caught >= 500, which is how
  // three 404s (a stale route list) were reported as "failing: 0".
  const bad = all.filter(
    (r) =>
      r.renderedError ||
      r.hydrationError ||
      (r.status != null && r.status >= 400) ||
      r.loadError,
  );
  // Tracked separately from `failing`: a soft redirect is a page that rendered a
  // gate instead of the route under test, which is a coverage hole rather than
  // an outage. Eleven authenticated routes reported status 200 while actually
  // showing /pending-access before this was detected.
  const soft = all.filter((r) => r.softRedirect);
  results.summary = {
    total: all.length,
    failing: bad.length,
    failingRoutes: bad.map(
      (r) => `${r.viewport} ${r.route} status=${r.status} ${r.loadError ?? ''}`.trim()
    ),
    softRedirects: soft.length,
    softRedirectRoutes: soft.map((r) => `${r.viewport} ${r.route} -> ${r.finalUrl}`),
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