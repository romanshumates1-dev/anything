/**
 * Live-app journey walker. Drives the running :4000 dev server in a real
 * (system Edge) browser: register → land authenticated → screenshot every
 * sidebar tab → exercise the leads-import paste path. Captures console errors
 * and failed network responses per page. Proof for BREAKAGE_TABLE rows.
 *
 * Run: node --env-file=.env scripts/live-walk.mjs
 * Screenshots + report land in e2e/.proof/.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'fs';

const BASE = 'http://localhost:4000';
const OUT = 'e2e/.proof';
mkdirSync(OUT, { recursive: true });

const TABS = [
  ['dashboard', '/'],
  ['campaigns', '/campaigns'],
  ['inbox', '/inbox'],
  ['approvals', '/approvals'],
  ['leads', '/leads'],
  ['analytics', '/analytics'],
  ['contracts', '/contracts'],
  ['settings', '/settings'],
  ['leads-import', '/leads/import'],
  ['campaign-wizard', '/campaigns/wizard'],
];

const report = [];

function attachListeners(page, bucket) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') bucket.consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => bucket.pageErrors.push(String(err)));
  page.on('response', (res) => {
    const s = res.status();
    if (s >= 400) bucket.failedResponses.push(`${s} ${res.request().method()} ${res.url()}`);
  });
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

// ---- REGISTER via the real signup GUI ----
// Domain-locked platform: signup must use an allowed domain, and the walk
// needs ADMIN (MIN_ACCESS_ROLE) — promoted via DB right after registering.
const email = `walk-${Date.now()}@dealswiftautomation.com`;
const password = 'Test1234!pass';
const authBucket = { step: 'register', consoleErrors: [], pageErrors: [], failedResponses: [] };
attachListeners(page, authBucket);

await page.goto(`${BASE}/account/signup`, { waitUntil: 'domcontentloaded' });
await page.screenshot({ path: `${OUT}/00-signup-form.png` });
await page.fill('input[type=email]', email);
await page.fill('input[type=password]', password);
await Promise.all([
  page.waitForURL(`${BASE}/`, { timeout: 30000 }).catch(() => {}),
  page.getByRole('button', { name: /Sign Up/ }).click(),
]);
await page.waitForLoadState('networkidle').catch(() => {});
authBucket.landedUrl = page.url();
await page.screenshot({ path: `${OUT}/01-after-register.png`, fullPage: true });
report.push(authBucket);
console.log(`[register] ${email} → landed at ${authBucket.landedUrl}`);

// promote the fresh user to ADMIN so the role gate lets the walk through
{
  const { neon } = await import('@neondatabase/serverless');
  const sqlAdmin = neon(process.env.DATABASE_URL);
  await sqlAdmin`UPDATE "user" SET role = 'ADMIN' WHERE email = ${email}`;
  console.log(`[register] ${email} promoted to ADMIN for the walk`);
}

// ---- WALK EVERY TAB ----
for (const [name, path] of TABS) {
  const bucket = { step: name, path, consoleErrors: [], pageErrors: [], failedResponses: [] };
  const p = await context.newPage();
  attachListeners(p, bucket);
  try {
    const resp = await p.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 45000 });
    bucket.httpStatus = resp?.status() ?? null;
    await p.waitForTimeout(800);
    bucket.landedUrl = p.url();
    // crude blank-render check: how much visible text is on the page
    bucket.bodyTextLen = (await p.locator('body').innerText().catch(() => '')).trim().length;
    await p.screenshot({ path: `${OUT}/tab-${name}.png`, fullPage: true });
  } catch (e) {
    bucket.navError = String(e);
  }
  report.push(bucket);
  console.log(`[${name}] ${path} → HTTP ${bucket.httpStatus} url=${bucket.landedUrl} textLen=${bucket.bodyTextLen} consoleErr=${bucket.consoleErrors.length} failedNet=${bucket.failedResponses.length}`);
  await p.close();
}

// ---- LEADS IMPORT: paste path ----
const imp = { step: 'leads-import-paste', consoleErrors: [], pageErrors: [], failedResponses: [] };
const ip = await context.newPage();
attachListeners(ip, imp);
try {
  await ip.goto(`${BASE}/leads/import`, { waitUntil: 'networkidle' });
  const textarea = ip.locator('textarea').first();
  if (await textarea.count()) {
    await textarea.fill('Alice, +15025550101\nBob, +15025550102\nCarol, +15025550103');
    imp.pastedIntoTextarea = true;
    await ip.screenshot({ path: `${OUT}/import-01-pasted.png`, fullPage: true });
  } else {
    imp.pastedIntoTextarea = false;
    imp.note = 'no textarea found on /leads/import';
  }
} catch (e) {
  imp.navError = String(e);
}
report.push(imp);
console.log(`[leads-import-paste] textarea=${imp.pastedIntoTextarea} consoleErr=${imp.consoleErrors.length}`);
await ip.close();

writeFileSync(`${OUT}/walk-report.json`, JSON.stringify(report, null, 2));
await browser.close();

// ---- SUMMARY ----
const totalConsole = report.reduce((n, r) => n + (r.consoleErrors?.length || 0), 0);
const totalPageErr = report.reduce((n, r) => n + (r.pageErrors?.length || 0), 0);
const totalFailedNet = report.reduce((n, r) => n + (r.failedResponses?.length || 0), 0);
console.log('\n=== WALK SUMMARY ===');
console.log(`steps=${report.length} consoleErrors=${totalConsole} pageErrors=${totalPageErr} failedResponses=${totalFailedNet}`);
console.log(`screenshots + walk-report.json in ${OUT}/`);
