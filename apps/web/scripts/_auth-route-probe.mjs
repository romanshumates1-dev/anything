// Authenticated 503/429 probe: log in, then walk the app routes capturing
// (url, status, body) for EVERY failing response.
// The unauthenticated crawl could not distinguish a Worker CPU abort from an
// application 429, which is how a rate limiter was previously misdiagnosed as
// a Cloudflare CPU ceiling.
import { readFileSync, existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const cred = JSON.parse(readFileSync(process.env.TEMP + '/qa-cred.json', 'utf8'));
const BASE = cred.base;
const ROUTES = (process.env.QA_ROUTES || '').split(',').filter(Boolean);

const EDGE = [
  process.env.EDGE_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean).find((p) => existsSync(p));

const browser = await chromium.launch({ executablePath: EDGE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

// The document response, captured separately: a 429 on the HTML document would
// otherwise be indistinguishable from a failing subresource.
async function visit(route) {
  const bad = new Map();
  const onRes = async (res) => {
    const st = res.status();
    if (st < 400) return;
    let body = '';
    try { body = (await res.text()).slice(0, 160).replace(/\s+/g, ' '); } catch { body = '<unreadable>'; }
    const key = `${st} ${new URL(res.url()).pathname}`;
    if (!bad.has(key)) bad.set(key, { n: 0, body });
    bad.get(key).n++;
  };
  page.on('response', onRes);
  const t0 = Date.now();
  let status = 'NAVFAIL';
  let final = '';
  try {
    const r = await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 60000 });
    status = r?.status() ?? 'NULL';
  } catch (e) {
    status = 'NAVFAIL:' + String(e.message).slice(0, 60);
  }
  await page.waitForTimeout(1200);
  final = page.url().replace(BASE, '') || '/';
  page.off('response', onRes);
  const ms = Date.now() - t0;
  const entries = [...bad.entries()].map(([k, v]) => `${v.n}x ${k} :: ${v.body}`);
  console.log(`\n${route} nav=${status} ${ms}ms final=${final}`);
  if (!entries.length) console.log('   clean');
  entries.forEach((e) => console.log('   ' + e));
  return { route, status, ms, final };
}

// ---- 1. sign in through the real form ----
await page.goto(BASE + '/account/signin', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.fill('input[type="email"]', cred.email);
await page.fill('input[type="password"]', cred.password);
await page.click('form button[type="submit"]');
await page.waitForTimeout(4000);
console.log('AFTER LOGIN url=', page.url().replace(BASE, ''));
const cookies = await ctx.cookies();
console.log('session cookie set:', cookies.some((c) => /session/i.test(c.name)));

// ---- 2. clear the legal gate (mirrors acceptLegalIfGated in the real harness) ----
if (/legal\/accept/.test(page.url())) {
  const result = await page.evaluate(async () => {
    const r = await fetch('/api/legal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keys: ['tos', 'privacy'] }),
    });
    return { status: r.status, body: (await r.text()).slice(0, 200) };
  });
  console.log('LEGAL ACCEPT', JSON.stringify(result));
  // Full navigation so middleware re-evaluates with the new rows.
  await page.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(800);
  console.log('AFTER LEGAL url=', page.url().replace(BASE, ''));
}

// ---- 3. walk the routes ----
const out = [];
for (const r of ROUTES) out.push(await visit(r));

const tally = {};
for (const o of out) tally[o.status] = (tally[o.status] || 0) + 1;
console.log('\nNAV STATUS TALLY', JSON.stringify(tally));
console.log('SOFT REDIRECTS', out.filter((o) => o.final !== o.route && o.final !== '/').map((o) => `${o.route}->${o.final}`));
await browser.close();
