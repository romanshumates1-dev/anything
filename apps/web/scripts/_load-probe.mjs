// Load-dependence probe. A route that is 200 alone but 503 after N other
// authenticated page loads is a CUMULATIVE CPU-budget problem, not a
// route-specific one — a materially different fix. Walks the same authenticated
// set repeatedly and records exactly which request flips to 503.
import { readFileSync, existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const cred = JSON.parse(readFileSync(process.env.TEMP + '/qa-cred.json', 'utf8'));
const BASE = cred.base;
const ROUTES = ['/dashboard', '/campaigns', '/crm', '/leads', '/contracts', '/payouts', '/reports', '/settings', '/settings/billing'];
const PASSES = Number(process.env.QA_PASSES || 3);

const EDGE = [process.env.EDGE_PATH, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe']
  .filter(Boolean).find((p) => existsSync(p));

const browser = await chromium.launch({ executablePath: EDGE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

await page.goto(BASE + '/account/signin', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.fill('input[type="email"]', cred.email);
await page.fill('input[type="password"]', cred.password);
await page.click('form button[type="submit"]');
await page.waitForTimeout(3500);
if (/legal\/accept/.test(page.url())) {
  await page.evaluate(() => fetch('/api/legal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ keys: ['tos', 'privacy'] }) }));
  await page.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
}
console.log('logged in ->', page.url().replace(BASE, ''));

for (let pass = 1; pass <= PASSES; pass++) {
  const line = [];
  for (const r of ROUTES) {
    let status;
    const t0 = Date.now();
    try {
      const res = await page.goto(BASE + r, { waitUntil: 'domcontentloaded', timeout: 60000 });
      status = res?.status();
    } catch {
      status = 'NAVFAIL';
    }
    line.push(`${r}=${status}/${Date.now() - t0}ms`);
  }
  console.log(`pass ${pass}: ` + line.join('  '));
}
await browser.close();
