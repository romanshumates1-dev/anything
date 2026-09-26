/**
 * Browser QA against the REAL deployed site.
 *
 * Previous sessions recorded browser QA as "BLOCKED — no installable browser". That is no
 * longer true: Microsoft Edge (and Brave) are installed locally and Playwright can drive any
 * Chromium-based browser by executable path, so no download is required.
 *
 * What this captures as EVIDENCE (not opinion):
 *   - HTTP status per route
 *   - every console error / page error
 *   - every failed network request
 *   - SEO/meta content actually rendered
 *   - viewport/responsive behaviour at mobile + desktop widths
 *   - screenshots
 *
 * Usage: node scripts/browser-qa.cjs [--base https://host]
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('@playwright/test');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BRAVE = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';

const argBase = (() => {
  const i = process.argv.indexOf('--base');
  return i > -1 ? process.argv[i + 1] : 'https://dealswiftautomation.com';
})();

const BASE = argBase.replace(/\/$/, '');
const OUT = path.resolve(__dirname, '..', '..', '..', 'browser-qa-artifacts');
fs.mkdirSync(OUT, { recursive: true });

// Public, unauthenticated surfaces a real first-time visitor can reach.
const ROUTES = [
  { p: '/', name: 'home' },
  { p: '/pricing', name: 'pricing' },
  { p: '/features', name: 'features' },
  { p: '/about', name: 'about' },
  { p: '/contact', name: 'contact' },
  { p: '/account/signin', name: 'signin' },
  { p: '/account/signup', name: 'signup' },
  { p: '/privacy', name: 'privacy' },
  { p: '/terms', name: 'terms' },
  { p: '/dashboard', name: 'dashboard-redirect' },
  { p: '/api/system/health', name: 'api-health' },
  { p: '/robots.txt', name: 'robots' },
  { p: '/sitemap.xml', name: 'sitemap' },
];

function pickBrowser() {
  if (fs.existsSync(EDGE)) return { name: 'msedge', exe: EDGE };
  if (fs.existsSync(BRAVE)) return { name: 'brave', exe: BRAVE };
  return null;
}

(async () => {
  const chosen = pickBrowser();
  if (!chosen) {
    console.log('RESULT: NO_BROWSER — neither Edge nor Brave found; browser QA unavailable.');
    process.exit(2);
  }
  console.log(`BROWSER: ${chosen.name} (${chosen.exe})`);
  console.log(`BASE:    ${BASE}\n`);

  const browser = await chromium.launch({
    executablePath: chosen.exe,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const report = { base: BASE, browser: chosen.name, routes: [], seo: {}, viewport: [] };

  for (const r of ROUTES) {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
    });
    const page = await ctx.newPage();

    const consoleErrors = [];
    const pageErrors = [];
    const failedRequests = [];
    const jsResponses = [];

    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300));
    });
    page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
    page.on('requestfailed', (req) => {
      const f = req.failure();
      failedRequests.push(`${req.method()} ${req.url().slice(0, 160)} :: ${f ? f.errorText : 'unknown'}`);
    });
    page.on('response', (res) => {
      if (res.request().resourceType() === 'script' && res.status() >= 400) {
        jsResponses.push(`${res.status()} ${res.url().slice(0, 160)}`);
      }
    });

    let status = null;
    let navError = null;
    const url = `${BASE}${r.p}`;
    try {
      const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      status = res ? res.status() : null;
      // Give client-side hydration a moment so runtime errors surface.
      await page.waitForTimeout(2500);
    } catch (e) {
      navError = String(e).slice(0, 200);
    }

    let title = null;
    let metaDesc = null;
    let canonical = null;
    let h1 = null;
    let bodyText = null;
    try {
      title = await page.title();
      metaDesc = await page
        .locator('meta[name="description"]')
        .getAttribute('content')
        .catch(() => null);
      canonical = await page
        .locator('link[rel="canonical"]')
        .getAttribute('href')
        .catch(() => null);
      h1 = (await page.locator('h1').first().innerText().catch(() => '')).slice(0, 120) || null;
      bodyText = (await page.locator('body').innerText().catch(() => '')).trim().slice(0, 300);
    } catch (e) {
      /* page may not have loaded */
    }

    let shot = null;
    try {
      const f = path.join(OUT, `${r.name}.png`);
      await page.screenshot({ path: f, fullPage: false });
      shot = path.relative(process.cwd(), f);
    } catch (e) {
      /* ignore */
    }

    report.routes.push({
      route: r.p,
      url,
      status,
      navError,
      title,
      h1,
      metaDescLength: metaDesc ? metaDesc.length : 0,
      canonical,
      consoleErrors,
      pageErrors,
      failedRequests,
      badScriptResponses: jsResponses,
      screenshot: shot,
      renderedChars: bodyText ? bodyText.length : 0,
    });

    const line = `  ${String(status ?? 'ERR').padEnd(4)} ${r.p.padEnd(28)} errs=${consoleErrors.length} pageErr=${pageErrors.length} netFail=${failedRequests.length} bytes=${bodyText ? bodyText.length : 0}`;
    console.log(line);

    await ctx.close();
  }

  // ---- Responsive check: does the home page actually reflow, and does it overflow? ----
  for (const vp of [
    { name: 'mobile-375', width: 375, height: 812 },
    { name: 'tablet-768', width: 768, height: 1024 },
    { name: 'desktop-1440', width: 1440, height: 900 },
  ]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    let overflow = null;
    let status = null;
    try {
      const res = await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      status = res ? res.status() : null;
      await page.waitForTimeout(1500);
      overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      await page.screenshot({ path: path.join(OUT, `responsive-${vp.name}.png`) });
    } catch (e) {
      overflow = `ERROR: ${String(e).slice(0, 120)}`;
    }
    report.viewport.push({ viewport: vp.name, width: vp.width, status, horizontalOverflowPx: overflow });
    console.log(`  VIEWPORT ${vp.name.padEnd(13)} status=${status} hOverflow=${overflow}px`);
    await ctx.close();
  }

  await browser.close();

  const outFile = path.join(OUT, 'report.json');
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`\nARTIFACTS: ${OUT}`);
  console.log(`REPORT:    ${outFile}`);

  // Machine-readable summary for the status doc.
  const withErrors = report.routes.filter(
    (r) => r.consoleErrors.length || r.pageErrors.length || r.failedRequests.length
  );
  console.log(`\nROUTES WITH BROWSER ERRORS: ${withErrors.length}/${report.routes.length}`);
  for (const r of withErrors) {
    console.log(`  ${r.route}`);
    r.pageErrors.forEach((e) => console.log(`     pageerror: ${e}`));
    r.consoleErrors.slice(0, 3).forEach((e) => console.log(`     console:   ${e}`));
    r.failedRequests.slice(0, 3).forEach((e) => console.log(`     netfail:   ${e}`));
  }
})().catch((e) => {
  console.error('BROWSER QA CRASHED:', e);
  process.exit(1);
});
