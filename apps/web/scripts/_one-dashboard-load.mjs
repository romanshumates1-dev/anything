// ONE authenticated dashboard page load while `wrangler tail` is attached.
//
// Single page load, then stop. Not a load test: one page is what a customer does,
// and it is enough to capture the real failure because the failure only appears
// when the page's ~17 fetches run together.
//
// Captures, per response: status, wall-clock, and — critically — whether the
// body is Cloudflare's own error page (which names the limit) or an application
// response. That distinction is what tells us CPU exhaustion apart from a
// subrequest-cap or application error, and guessing between them wastes hours.
//
// Run: node scripts/_one-dashboard-load.mjs   (with `wrangler tail` running)
import { readFileSync, existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const cred = JSON.parse(readFileSync(process.env.TEMP + '/qa-cred.json', 'utf8'));
const BASE = cred.base;

const EDGE = [process.env.EDGE_PATH, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe']
  .filter(Boolean).find((p) => existsSync(p));

const browser = await chromium.launch({ executablePath: EDGE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const seen = new Map();
page.on('response', async (res) => {
  const st = res.status();
  if (st < 400) return;
  let body = '';
  try {
    body = (await res.text()).slice(0, 300).replace(/\s+/g, ' ');
  } catch {
    body = '<unreadable>';
  }
  const path = new URL(res.url()).pathname;
  const key = `${st} ${path}`;
  if (!seen.has(key)) seen.set(key, { n: 0, body });
  seen.get(key).n++;
});

// Sign in through the real form.
await page.goto(`${BASE}/account/signin`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.fill('input[type="email"]', cred.email);
await page.fill('input[type="password"]', cred.password);
await page.click('form button[type="submit"]');
await page.waitForTimeout(3500);

// Clear the legal gate if present.
if (/legal\/accept/.test(page.url())) {
  await page.evaluate(() =>
    fetch('/api/legal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keys: ['tos', 'privacy'] }),
    })
  );
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(600);
}

console.log('signed in ->', page.url().replace(BASE, ''));
console.log('loading /dashboard ONCE, waiting for the network to settle...\n');

// ONE navigation. The whole point is to watch the fan-out happen naturally.
const t0 = Date.now();
const nav = await page
  .goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 90000 })
  .catch((e) => ({ status: () => 'NAVFAIL:' + e.message.slice(0, 60) }));
await page.waitForTimeout(9000); // let all the fan-out requests finish
const elapsed = Date.now() - t0;

console.log(`nav status = ${nav.status()}   total wall clock = ${elapsed}ms`);
console.log(`final url  = ${page.url().replace(BASE, '')}\n`);

if (seen.size === 0) console.log('no 4xx/5xx on this load');
for (const [k, v] of seen) {
  console.log(`${v.n}x ${k}`);
  console.log(`   body: ${v.body}`);
}

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 160)));
console.log(`\npage errors observed: ${pageErrors.length}`);
pageErrors.forEach((e) => console.log('   ' + e));

await browser.close();
