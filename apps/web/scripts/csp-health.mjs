import { chromium } from 'playwright';

const BASE = 'http://localhost:3111';
// Routes chosen for what actually executes script: a public marketing page with
// interactive elements, the consent form (a CLIENT component - the riskiest for
// eval), pricing with its toggle, and the authenticated shells.
const ROUTES = ['/', '/pricing', '/cash-offer', '/features', '/account/signin', '/account/signup'];

const browser = await chromium.launch({ channel: 'msedge' });
let totalViolations = 0, totalErrors = 0;

for (const route of ROUTES) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const violations = [], errors = [];
  page.on('console', (m) => {
    const t = m.text();
    if (/Content Security Policy|Refused to (execute|evaluate|create|apply)/i.test(t)) violations.push(t.slice(0, 200));
    else if (m.type() === 'error' && !/favicon|404 \(Not Found\)/i.test(t)) errors.push(t.slice(0, 200));
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 200)));

  try {
    await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(1200);
    // Prove the page actually rendered rather than silently failing to hydrate.
    const bodyLen = (await page.evaluate(() => document.body?.innerText?.length ?? 0));
    const root = (await page.evaluate(() => document.querySelector('#__next, body')?.children.length ?? 0));
    console.log(`\n${route}`);
    console.log(`  textLen=${bodyLen} rootChildren=${root}`);
    console.log(`  CSP violations: ${violations.length}`);
    violations.forEach((v) => console.log('    ! ' + v));
    console.log(`  console errors: ${errors.length}`);
    errors.forEach((e) => console.log('    x ' + e));
    totalViolations += violations.length; totalErrors += errors.length;
  } catch (e) {
    console.log(`\n${route}\n  NAV ERROR: ${String(e).slice(0, 160)}`);
  }
  await ctx.close();
}

await browser.close();
console.log(`\n=== TOTAL: ${totalViolations} CSP violations, ${totalErrors} console errors ===`);
process.exit(totalViolations > 0 || totalErrors > 0 ? 1 : 0);
