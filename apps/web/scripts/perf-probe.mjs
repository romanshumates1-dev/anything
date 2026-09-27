import { chromium } from 'playwright';

const BASE = 'http://localhost:3111';
const ROUTES = ['/', '/pricing', '/features', '/how-it-works', '/legal/terms', '/cash-offer', '/faq', '/about'];
const RUNS = 3;

const browser = await chromium.launch({ channel: 'msedge' });
console.log('route                 p50      p95      min      max    bytes');
console.log('-'.repeat(64));
const rows = [];
for (const route of ROUTES) {
  const times = [];
  let bytes = 0;
  for (let i = 0; i < RUNS; i++) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    let size = 0;
    page.on('response', async (res) => {
      try { const b = await res.body(); size += b.length; } catch {}
    });
    const t0 = Date.now();
    await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 60000 });
    times.push(Date.now() - t0);
    if (i === 0) bytes = size;
    await ctx.close();
  }
  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length / 2)];
  const p95 = times[Math.ceil(times.length * 0.95) - 1];
  const min = times[0], max = times[times.length - 1];
  rows.push({ route, p50, p95, max, bytes });
  console.log(
    route.padEnd(20) +
    String(p50 + 'ms').padEnd(8) +
    String(p95 + 'ms').padEnd(8) +
    String(min + 'ms').padEnd(8) +
    String(max + 'ms').padEnd(7) +
    String(Math.round(bytes / 1024) + 'KB')
  );
}
await browser.close();
const worst = rows.slice().sort((a, b) => b.p95 - a.p95)[0];
console.log(`\nslowest by p95: ${worst.route} at ${worst.p95}ms`);
