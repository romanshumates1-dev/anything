/**
 * Real-browser QA harness (Microsoft Edge via Playwright).
 *
 * WHY EDGE: `npx playwright install chromium` fails in this environment
 * (CDN download blocked, code=1) and no Chrome is installed. Edge is
 * Chromium-based, ships with Windows, and Playwright drives it directly via
 * executablePath - so real browser verification IS possible here rather than
 * being waved off as "no browser available".
 *
 * WHAT IT CHECKS (per route, not just a status code):
 *   - HTTP status
 *   - REAL rendered bytes (a dev compile shell is ~300 bytes; real pages are
 *     tens of KB) plus visible-text length, so a blank or error page cannot pass
 *   - page <title>
 *   - browser CONSOLE errors
 *   - failed / 4xx-5xx NETWORK requests
 *   - whether an UNAUTHENTICATED visitor is correctly bounced off a protected
 *     route (an authorization check, not a rendering check)
 *
 * Usage: node scripts/browser-qa.mjs [baseUrl]
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.argv[2] || 'http://localhost:3111';

// [path, kind, expectAuthRedirect]
//
// NOTE: these are REAL routes taken from the actual src/app tree. An earlier
// version of this harness probed /contacts, which does not exist in this
// product (the equivalent surface is /leads) and so 404'd - that was a harness
// bug being misread as an application defect. Route lists must be derived from
// the app tree, not from assumed product vocabulary.
const ROUTES = [
  ['/', 'public', false],
  ['/pricing', 'public', false],
  ['/features', 'public', false],
  ['/about', 'public', false],
  ['/contact', 'public', false],
  ['/privacy', 'public', false],
  ['/terms', 'public', false],
  ['/faq', 'public', false],
  ['/reviews', 'public', false],
  ['/trust', 'public', false],
  ['/how-it-works', 'public', false],
  ['/cash-offer', 'public', false],
  ['/compliance', 'public', false],
  ['/account/signin', 'public', false],
  ['/account/signup', 'public', false],
  ['/account/forgot-password', 'public', false],
  ['/dashboard', 'protected', true],
  ['/campaigns', 'protected', true],
  ['/leads', 'protected', true],
  ['/crm', 'protected', true],
  ['/contracts', 'protected', true],
  ['/inbox', 'protected', true],
  ['/analytics', 'protected', true],
  ['/payouts', 'protected', true],
  ['/settings', 'protected', true],
  ['/admin', 'protected', true],
  ['/admin/users', 'protected', true],
  ['/admin/billing', 'protected', true],
  ['/lead-finder', 'protected', true],
  ['/templates', 'protected', true],
  ['/reports', 'protected', true],
  ['/buyers', 'protected', true],
  ['/approvals', 'protected', true],
  ['/funnel', 'protected', true],
  ['/profile', 'protected', true],
];

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

function extract(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const results = [];
const browser = await chromium.launch({
  executablePath: EDGE,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

/**
 * AUTHENTICATED MODE (`--auth`).
 *
 * The default pass deliberately uses a FRESH context, which proves the auth
 * wall: an anonymous visitor must be bounced off every protected route. That
 * is only half the evidence. With `--auth` the context is seeded with the
 * Playwright storage state that e2e/global-setup.ts produced by registering a
 * REAL account against the REAL database, so protected routes are expected to
 * RENDER rather than redirect — that is what actually proves the application
 * works for a signed-in user.
 *
 * `node scripts/browser-qa.mjs http://localhost:4000 --auth`
 */
const AUTH_MODE = process.argv.includes('--auth');
const RESULTS_SUFFIX = AUTH_MODE ? '-authenticated' : '';
const STORAGE_STATE = 'e2e/.auth/state.json';
if (AUTH_MODE && !existsSync(STORAGE_STATE)) {
  console.error(
    `--auth requires ${STORAGE_STATE}. Run \`yarn test:e2e\` first: its global setup registers the account and writes the state file.`
  );
  process.exit(2);
}

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.name === 'mobile',
    hasTouch: vp.name === 'mobile',
    ...(AUTH_MODE ? { storageState: STORAGE_STATE } : {}),
  });

  // Warm-up pass: in `next dev` the FIRST request to a route pays an on-demand
  // compile, so measuring it reports compile latency rather than the app. Each
  // route is fetched once and discarded before anything is measured.
  if (process.argv.includes('--warm')) {
    const warm = await context.newPage();
    for (const [route] of ROUTES) {
      await warm
        .goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 60000 })
        .catch(() => {});
    }
    await warm.close();
    console.log('[warm] compile warm-up complete');
  }

  for (const [route, kind, expectRedirect] of ROUTES) {
    const page = await context.newPage();
    const consoleErrors = [];
    const netFailures = [];

    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300));
    });
    page.on('requestfailed', (r) => {
      // Next.js App Router prefetches RSC payloads (?_rsc=...) and ABORTS them
      // by design when the link leaves the viewport or navigation supersedes
      // them. Flagging those turns every page into a false failure, so they are
      // excluded - genuine 4xx/5xx responses are still caught by the handler
      // below, which is the signal that actually matters.
      if (r.url().includes('_rsc=')) return;
      netFailures.push(`${r.url().slice(0, 160)} :: ${r.failure()?.errorText ?? '?'}`);
    });
    page.on('response', (r) => {
      if (r.url().includes('_rsc=')) return;
      if (r.status() >= 400) netFailures.push(`${r.status()} ${r.url().slice(0, 160)}`);
    });

    let status = 0;
    let bytes = 0;
    let textLen = 0;
    let title = '';
    let error = null;
    const t0 = Date.now();

    try {
      const resp = await page.goto(BASE + route, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      status = resp?.status() ?? 0;
      // Wait for hydration so we exercise the real client, not just SSR HTML.
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      const html = await page.content();
      bytes = html.length;
      textLen = extract(html).length;
      title = (await page.title()) || '';
    } catch (e) {
      error = String(e).split('\n')[0].slice(0, 200);
    }
    const elapsed = Date.now() - t0;

    // An unauthenticated visitor must NOT be able to render a protected page.
    // In AUTHENTICATED mode the same routes are expected to RENDER, and a
    // redirect to the login page is then the failure (a stale/absent session
    // would otherwise look like a pass).
    let authGuardOk = null;
    if (kind === 'protected') {
      const body = extract(await page.content()).toLowerCase();
      const onLogin = /signin|login|unauthorized|forbidden/i.test(page.url());
      const looksProtected =
        /sign in|log in|unauthorized|access denied|authentication required/.test(body);
      authGuardOk = AUTH_MODE ? !onLogin : onLogin || looksProtected;
    }

    // A correctly-bounced protected route lands on the sign-in page, which is
    // legitimately short. Demanding 400+ chars of text there produced 40+
    // phantom failures; the requirement is that the GUARD fired, not that the
    // login page be verbose. In authenticated mode the same routes must render
    // real content instead.
    const isLoginPage =
      /\/account\/signin|signin|login/i.test(page.url()) ||
      /sign in|log in/i.test(extract(await page.content()));
    const realContent =
      bytes > 5000 && (textLen > 400 || (kind === 'protected' && !AUTH_MODE && isLoginPage));
    results.push({
      viewport: vp.name,
      route,
      kind,
      status,
      bytes,
      textLen,
      title: title.slice(0, 80),
      elapsedMs: elapsed,
      realContent,
      expectRedirect,
      authGuardOk,
      consoleErrors: consoleErrors.slice(0, 5),
      netFailures: netFailures.slice(0, 5),
      error,
    });

    if (vp.name === 'desktop' && realContent) {
      await page
        .screenshot({
          path: `artifacts/browser-qa/${route === '/' ? 'home' : route.replace(/\//g, '_')}.png`,
        })
        .catch(() => {});
    }
    await page.close();
  }
  await context.close();
}

await browser.close();
// The directory must exist BEFORE the write: previously writeFileSync ran
// above mkdirSync and only survived because screenshots happened to create it.
mkdirSync('artifacts/browser-qa', { recursive: true });
writeFileSync(
  `artifacts/browser-qa/results${RESULTS_SUFFIX}.json`,
  JSON.stringify(results, null, 2)
);

let pass = 0;
let fail = 0;
for (const r of results) {
  const problems = [];
  if (r.error) problems.push(`ERROR ${r.error}`);
  if (!r.realContent) problems.push(`THIN bytes=${r.bytes} text=${r.textLen}`);
  if (r.status >= 400) problems.push(`HTTP ${r.status}`);
  if (r.expectRedirect && r.authGuardOk === false) problems.push('AUTH GUARD MISSING');
  if (r.netFailures.length) problems.push(`net:${r.netFailures.length}`);
  if (r.consoleErrors.length) problems.push(`console:${r.consoleErrors.length}`);
  const ok = problems.length === 0;
  ok ? pass++ : fail++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} [${r.viewport.padEnd(7)}] ${r.route.padEnd(26)} ` +
      `${String(r.status).padEnd(4)} ${String(r.bytes).padStart(7)}B text=${String(r.textLen).padStart(6)} ` +
      `${String(r.elapsedMs).padStart(6)}ms${problems.length ? '  << ' + problems.join(' ') : ''}`
  );
  if (r.consoleErrors.length) console.log(`        console: ${r.consoleErrors[0]}`);
  if (r.netFailures.length) console.log(`        net:     ${r.netFailures[0]}`);
}
console.log(`\nTOTAL: ${pass} pass, ${fail} fail (of ${results.length})`);
process.exit(fail > 0 ? 1 : 0);
