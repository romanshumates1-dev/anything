import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'msedge' });
for (const route of ['/', '/pricing', '/faq']) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const js = [];
  page.on('response', async (r) => {
    const u = r.url();
    if (u.endsWith('.js') || u.includes('/_next/static/chunks')) {
      try { const b = await r.body(); js.push({ n: u.split('/').pop(), kb: b.length / 1024 }); } catch {}
    }
  });
  await page.goto('http://localhost:3111' + route, { waitUntil: 'networkidle', timeout: 60000 });
  const total = js.reduce((a, x) => a + x.kb, 0);
  const big = js.sort((a, b) => b.kb - a.kb).slice(0, 4);
  // Identify whether a charting/date library reached the public page.
  const all = (await Promise.all(js.slice(0, 40).map(async () => '')));
  console.log(`\n${route}  jsTotal=${Math.round(total)}KB  files=${js.length}`);
  big.forEach((x) => console.log(`   ${Math.round(x.kb)}KB  ${x.n}`));
  await ctx.close();
}
await browser.close();
