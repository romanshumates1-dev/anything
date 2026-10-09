import { test, expect, type Page, type Request } from '@playwright/test';

/**
 * H1 — authenticated browser console sweep (LOCAL half).
 *
 * WHY THIS SPEC EXISTS
 * --------------------
 * HTTP status codes cannot prove an authenticated page throws nothing
 * client-side, and the SSR/unit suites render Shell in jsdom (no layout, no
 * hydration, no real API fan-out). This spec drives a real browser (system
 * Edge, per playwright.config) against the LOCAL dev server on :4000 with the
 * real ADMIN session that `global-setup.ts` mints into `e2e/.auth/state.json`.
 *
 * SCOPE / HONESTY BOUNDARY (read before citing this as closing H1)
 * ----------------------------------------------------------------
 * The two remaining H1 noises recorded in UNIFIED-REQUIREMENTS-MATRIX are
 * PRODUCTION-only phenomena that a local dev server cannot produce:
 *   - the Cloudflare RUM beacon (`/cdn-cgi/rum`) aborted on navigation — it is
 *     injected by Cloudflare's edge and is absent on localhost; and
 *   - the 503/1102 CPU-ceiling burst under sustained load — a property of the
 *     deployed Worker's limits, not of the app's client code.
 * A green run HERE therefore proves: "authenticated pages throw no uncaught
 * exception, render no error boundary, and leak no fabricated mock data under
 * a real browser + real session." It does NOT prove production sustained-load
 * console cleanliness. That half stays gated behind DEPLOY (G2) — which is
 * BLOCKED-EXTERNAL (no Cloudflare auth). This spec is the LOCAL evidence for
 * H1, nothing more.
 *
 * The benign-abort filter below is copied by rationale from
 * `scripts/authenticated-console-check.mjs`, where every shape was measured on
 * 2026-10-04: React strict-mode double-mount cancels in-flight fetches, the
 * router cancels RSC prefetches (`?_rsc=`) and chunk loads on navigation. Those
 * are the harness, not the product. Anything NOT matching stays a real failure.
 */

const BASE = 'http://localhost:4000';

type Bucket = {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  benignAborts: string[];
};

const freshBucket = (): Bucket => ({
  consoleErrors: [],
  pageErrors: [],
  failedRequests: [],
  benignAborts: [],
});

/** Measured classification — see the header. Do not broaden without evidence. */
function isBenignAbort(r: Request): boolean {
  const err = r.failure()?.errorText ?? '';
  if (err !== 'net::ERR_ABORTED') return false;
  const url = r.url();
  return (
    url.includes('_next/static/chunks/') ||
    url.includes('_rsc=') ||
    url.includes('/cdn-cgi/') ||
    r.resourceType() === 'fetch' ||
    r.resourceType() === 'prefetch' ||
    r.resourceType() === 'script'
  );
}


/**
 * Route list mirrors `scripts/authenticated-console-check.mjs` for parity.
 * `mustNotContain` pins the two pages that once served HARDCODED rows and never
 * called their API (post-`fa43bd0`): a 200 there proves nothing unless the
 * fabricated strings are absent. These exact strings were verified to appear
 * NOWHERE in the DB — "Platinum Club"/"Revenue Machine" are REAL seed rows from
 * migration 068, so they are deliberately NOT in the list.
 */
const AUTH_ROUTES: { path: string; mustNotContain?: string[] }[] = [
  { path: '/dashboard' },
  { path: '/campaigns' },
  { path: '/lead-finder' },
  { path: '/settings/billing' },
  { path: '/achievements', mustNotContain: ['2024-01-15', '2024-02-01'] },
  {
    path: '/inbox',
    mustNotContain: ['John Smith', 'Sarah Johnson', 'Bob Wilson', 'Jane Doe', '(555)'],
  },
];

type SweepResult = {
  status: number;
  finalUrl: string;
  hasContent: boolean;
  errorBoundary: boolean;
  leaked: string[];
  bucket: Bucket;
};

async function sweepRoute(
  page: Page,
  path: string,
  mustNotContain: string[],
): Promise<SweepResult> {
  const bucket = freshBucket();
  wire(page, bucket);

  const res = await page.goto(`${BASE}${path}`, {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  });
  const status = res ? res.status() : 0;

  // Correctness = "did the page deliver its content", not "did the network fall
  // silent" (a content check, not a network-idle wait — the latter would
  // describe the harness, per the console-check notes).
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

  const body = await page.content().catch(() => '');
  const errorBoundary = /Application error|error-boundary|Something went wrong/i.test(body);
  const leaked = mustNotContain.filter((s) => body.includes(s));

  page.removeAllListeners('console');
  page.removeAllListeners('pageerror');
  page.removeAllListeners('requestfailed');

  return { status, finalUrl: page.url(), hasContent, errorBoundary, leaked, bucket };
}

/**
 * Attach the four listeners the script wires. Failed requests are only counted
 * when they target our own origin (BASE) — a CDN font or favicon dropping on
 * navigation is not this app's failure. `ERR_ABORTED` is split into benign vs
 * real via `isBenignAbort` above (measured rationale there).
 */
function wire(p: Page, bucket: Bucket): void {
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
}

/**
 * WHAT IS ASSERTED HARD, AND WHAT IS ONLY REPORTED — read before changing.
 * ------------------------------------------------------------------------
 * HARD failures (environment-independent product defects):
 *   - no authenticated session  -> an unauthenticated sweep renders clean
 *     pages and proves nothing (the script's "FATAL" rule, kept as a test).
 *   - an uncaught page exception (`pageErrors`) -> a real crash, dev or prod.
 *   - an error boundary rendered -> a real crash surface.
 *   - fabricated mock data present (`leaked`) -> H2/fa43bd0 regression.
 *   - the page delivered no visible content -> the page is broken/blank.
 *
 * REPORTED, NOT hard-failed: `consoleErrors`.
 *   H1's outstanding concern is PRODUCTION console cleanliness under sustained
 *   load, and the two recorded noises (CF RUM beacon, 503/1102 CPU ceiling) are
 *   production-only / DEPLOY-blocked. A local Next.js dev server additionally
 *   emits dev-only React console noise (hydration, fast-refresh) that does not
 *   occur in a production build. Conflating that with H1 would either force us
 *   to blanket-filter (masking a real prod error) or report a false red. So
 *   console output is captured and attached as evidence, and printed, but is
 *   not the pass/fail gate here. `pageerror` IS the gate: an uncaught exception
 *   is an environment-independent defect.
 *
 * Serial ordering is already guaranteed by playwright.config (`workers: 1`,
 * `fullyParallel: false`), so no `test.describe.configure()` is needed here.
 */

test('authenticated session is valid (anti-vacuity guard)', async ({ page }) => {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  const probe = await page.evaluate(async () => {
    const r = await fetch('/api/auth/get-session', { credentials: 'include' });
    const j = await r.json().catch(() => null);
    return { status: r.status, hasSession: !!(j && j.user && j.user.id) };
  });
  // If this fails, global-setup did not mint a session (or storageState is
  // stale). Every route below would then be verified while logged OUT.
  expect(probe.hasSession, `no authenticated session (probe=${JSON.stringify(probe)})`).toBe(true);
});

for (const { path, mustNotContain } of AUTH_ROUTES) {
  test(`authenticated ${path} renders real content with no crash/boundary/leak`, async ({ page }) => {
    test.info().annotations.push({ type: 'h1-local-half', description: path });

    const r = await sweepRoute(page, path, mustNotContain ?? []);

    // Surface the evidence on every route, pass or fail.
    await test.info().attach(`console-${path.replace(/\W+/g, '_')}.txt`, {
      body: JSON.stringify(
        {
          status: r.status,
          finalUrl: r.finalUrl,
          hasContent: r.hasContent,
          errorBoundary: r.errorBoundary,
          leaked: r.leaked,
          consoleErrors: r.bucket.consoleErrors,
          pageErrors: r.bucket.pageErrors,
          failedRequests: r.bucket.failedRequests,
          benignAborts: r.bucket.benignAborts,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    console.log(
      `${path} -> status=${r.status} content=${r.hasContent} boundary=${r.errorBoundary} ` +
        `leak=${r.leaked.length} console=${r.bucket.consoleErrors.length} ` +
        `pageErr=${r.bucket.pageErrors.length} failedReq=${r.bucket.failedRequests.length} ` +
        `(aborted=${r.bucket.benignAborts.length} benign)`,
    );

    // HARD gates — environment-independent product defects.
    expect(r.errorBoundary, 'an error boundary rendered on an authenticated page').toBe(false);
    expect(r.bucket.pageErrors, `uncaught exception(s): ${r.bucket.pageErrors.join(' | ')}`).toEqual([]);
    expect(r.bucket.failedRequests, `failed same-origin request(s): ${r.bucket.failedRequests.join(' | ')}`).toEqual([]);
    expect(r.leaked, `fabricated mock data still rendered: ${r.leaked.join(', ')}`).toEqual([]);
    expect(r.hasContent, 'page delivered no visible h1/main content').toBe(true);
  });
}


