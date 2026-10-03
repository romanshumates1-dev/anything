// ONE authenticated /dashboard load: how many Worker invocations does it cost,
// and how long until the network settles?
//
// This is the before/after measurement for the fan-out consolidation. Before:
// ~17 /api/ requests per load. After: 1 batched + the Shell's own requests.
//
// Not a load test — one page load, the way a customer loads it. Nothing here is
// fired concurrently on purpose.
//
// Run: node scripts/_dashboard-request-count.mjs
import { readFileSync, existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const cred = JSON.parse(readFileSync(process.env.TEMP + '/qa-cred.json', 'utf8'));
const BASE = cred.base;

const EDGE = [
  process.env.EDGE_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
]
  .filter(Boolean)
  .find((p) => existsSync(p));

const browser = await chromium.launch({ executablePath: EDGE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

/** Every request, keyed by path, so fan-out width is visible and countable. */
const api = new Map();
let lastApiAt = 0;
const failed = [];

page.on('request', (req) => {
  const url = new URL(req.url());
  if (!url.pathname.startsWith('/api/')) return;
  api.set(url.pathname, (api.get(url.pathname) ?? 0) + 1);
  lastApiAt = Date.now();
});
page.on('response', (res) => {
  if (res.status() >= 400) {
    failed.push(`${res.status()} ${new URL(res.url()).pathname}`);
  }
});

await page.goto(`${BASE}/account/signin`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.fill('input[type="email"]', cred.email);
await page.fill('input[type="password"]', cred.password);
await page.click('form button[type="submit"]');
await page.waitForTimeout(3500);

if (/legal\/accept/.test(page.url())) {
  await page.evaluate(() =>
    fetch('/api/legal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keys: ['tos', 'privacy'] }),
    })
  );
}

console.log('signed in ->', page.url().replace(BASE, ''));
console.log('loading /dashboard once...\n');

api.clear();
lastApiAt = 0;
const t0 = Date.now();
await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 90000 });

// Wait for the network to go quiet, up to 25s.
await page.waitForTimeout(2000);
while (Date.now() - lastApiAt < 3000 && Date.now() - t0 < 25000) {
  await page.waitForTimeout(500);
}
const settleMs = Date.now() - t0;

const total = [...api.values()].reduce((a, b) => a + b, 0);
console.log(`document + app settled in ${settleMs}ms`);
console.log(`\n/api/ requests during the dashboard load: ${total}`);
for (const [path, n] of [...api.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${n}x ${path}`);
}

console.log(`\nfailed responses: ${failed.length}`);
failed.forEach((f) => console.log(`  ${f}`));

// Sanity: the dashboard must actually show real data, not the old sample values.
const body = await page.textContent('body');
const FABRICATED = ['847', '623', '102,000', 'Call back Sarah Davis', 'Net this month'];
const leaked = FABRICATED.filter((needle) => body.includes(needle));
console.log(`\nfabricated sample values visible on the page: ${leaked.length ? leaked.join(', ') : 'none'}`);

await browser.close();
