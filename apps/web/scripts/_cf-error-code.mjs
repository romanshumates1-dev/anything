// Extracts the Cloudflare error CODE (not just the generic 503) so the failure
// is attributed correctly. Cloudflare error 1102 = "Worker exceeded resource
// limits"; 1101 = "Worker threw exception"; 1012/1000 = service errors. The
// status alone cannot tell these apart, and the whole diagnosis hinges on it.
import { readFileSync, existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const cred = JSON.parse(readFileSync(process.env.TEMP + '/qa-cred.json', 'utf8'));
const BASE = cred.base;
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

// Push until a 503 appears, then read its cf-error / Ray ID and body text.
const ROUTES = ['/dashboard', '/campaigns', '/crm', '/leads', '/contracts', '/payouts', '/reports', '/settings', '/settings/billing'];
let captured = 0;
for (let pass = 1; pass <= 6 && captured < 2; pass++) {
  for (const r of ROUTES) {
    let res = null;
    try { res = await page.goto(BASE + r, { waitUntil: 'domcontentloaded', timeout: 60000 }); } catch {}
    const st = res?.status();
    if (st && st >= 500) {
      captured++;
      const h = res.headers();
      console.log(`\n### ${r} -> ${st} (pass ${pass})`);
      console.log('cf-ray:', h['cf-ray'] || '(none)');
      console.log('cf-cache-status:', h['cf-cache-status'] || '(none)');
      console.log('server-timing:', h['server-timing'] || '(none)');
      const txt = await res.text().catch(() => '');
      // Cloudflare's error page states the code in prose and in the Ray ID.
      const m = txt.match(/Error\s+(\d{4})/i) || txt.match(/\b(1102|1101|1012|1000|1020|1027)\b/);
      console.log('CF ERROR CODE:', m ? m[1] : 'not found in body');
      const title = txt.match(/<span class="code-label">(.*?)<\/span>/i) || txt.match(/<h2[^>]*>(.*?)<\/h2>/i);
      console.log('headline:', title ? title[1].replace(/<[^>]+>/g, '').trim() : '(none)');
      const para = txt.match(/<p>(.*?)<\/p>/is);
      console.log('detail:', para ? para[1].replace(/<[^>]+>/g, '').trim().slice(0, 300) : '(none)');
    }
  }
}
if (!captured) console.log('no 5xx reproduced in 6 passes x ' + ROUTES.length + ' routes');
await browser.close();
