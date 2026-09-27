/**
 * One-off diagnostic: what does a REAL browser see on a route?
 *   node scripts/inspect-route.mjs /account/signin
 * Captures console errors, page errors, failed requests, rendered text and
 * element counts. Used to tell "the page is broken" from "the page is fine and
 * my assertion was wrong".
 */
import { chromium } from 'playwright';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://localhost:4000';
const route = process.argv[2] || '/account/signin';
// `--auth` reuses the Playwright storage state written by e2e/global-setup.ts,
// i.e. a genuine authenticated session against the real database.
const withAuth = process.argv.includes('--auth');
const STORAGE_STATE = 'e2e/.auth/state.json';

const browser = await chromium.launch({
  executablePath: EDGE,
  args: ['--no-sandbox'],
});
const context = await browser.newContext(
  withAuth ? { storageState: STORAGE_STATE } : {}
);
const page = await context.newPage();

const consoleErrors = [];
const pageErrors = [];
const failures = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300));
});
page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 300)));
page.on('requestfailed', (r) => {
  if (!r.url().includes('_rsc=')) {
    failures.push(`${r.url().slice(0, 120)} :: ${r.failure()?.errorText}`);
  }
});
page.on('response', (r) => {
  if (!r.url().includes('_rsc=') && r.status() >= 400) {
    failures.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`);
  }
});

const resp = await page.goto(BASE + route, {
  waitUntil: 'domcontentloaded',
  timeout: 45000,
});
await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(2000);

const text = await page
  .locator('body')
  .innerText()
  .catch(() => '');
console.log(`route: ${route}`);
console.log(`status: ${resp?.status()}`);
console.log(`final URL: ${page.url()}`);
console.log(`body text length: ${text.length}`);
console.log(`BODY TEXT >>> ${text.replace(/\s+/g, ' ').slice(0, 400)}`);
console.log(`inputs: ${await page.locator('input').count()}`);
console.log(`buttons: ${await page.locator('button').count()}`);
console.log(`forms: ${await page.locator('form').count()}`);
console.log(`headings: ${JSON.stringify(await page.locator('h1, h2').allTextContents())}`);

// Field inventory: ids/names/labels matter more than counts when a spec's
// selector fails, so print them explicitly.
const fields = await page
  .locator('input, textarea, select')
  .evaluateAll((els) =>
    els.map((el) => ({
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      name: el.getAttribute('name') || null,
      type: el.getAttribute('type') || null,
      placeholder: el.getAttribute('placeholder') || null,
      ariaLabel: el.getAttribute('aria-label') || null,
    }))
  );
console.log(`FIELDS: ${JSON.stringify(fields, null, 1)}`);

console.log(`console errors (${consoleErrors.length}):`);
for (const e of consoleErrors.slice(0, 8)) console.log(`   ${e}`);
console.log(`page errors (${pageErrors.length}):`);
for (const e of pageErrors.slice(0, 5)) console.log(`   ${e}`);
console.log(`failed requests (${failures.length}):`);
for (const f of failures.slice(0, 8)) console.log(`   ${f}`);

await browser.close();
