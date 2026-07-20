// Phase G evidence — screenshot the rendered globe (happy path) and the
// hard-failure fallback (geo fetch blocked). Asserts console clean on the happy
// path and that the fallback logs [globe] GEO LOAD FAILED. (Distinct from the
// older globe-verify.mjs which checks dot overlays.)
//   node --env-file=.env scripts/globe-geo-verify.mjs
import { chromium } from '@playwright/test';
import { neon } from '@neondatabase/serverless';
import { mkdirSync } from 'fs';

const BASE = 'http://localhost:4000';
const sql = neon(process.env.DATABASE_URL);
const email = `globe-${Date.now()}@dealswiftautomation.com`;
mkdirSync('e2e/.proof', { recursive: true });
let failures = 0;
const ok = (c, m) => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) failures++; };

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
await ctx.request.post(`${BASE}/api/auth/sign-up/email`, {
  data: { email, password: 'Str0ngPass!234', name: 'Globe Geo Verify' }, headers: { 'content-type': 'application/json' },
});
await sql`UPDATE "user" SET role='ADMIN' WHERE email=${email}`;

console.log('\n[G.happy] globe renders bundled land');
const errors = [];
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));

const asset = await ctx.request.get(`${BASE}/geo/land-50m.json`);
const assetBody = await asset.json().catch(() => ({}));
ok(asset.status() === 200 && assetBody.rings?.length > 1000, `bundled /geo/land-50m.json served: ${asset.status()}, ${assetBody.rings?.length} rings`);

await page.goto(`${BASE}/analytics`, { waitUntil: 'networkidle' });
const canvas = page.locator('canvas[aria-label*="globe" i]').first();
await canvas.waitFor({ state: 'visible', timeout: 15000 });
await page.waitForTimeout(4000);
ok(await canvas.isVisible(), 'globe canvas visible');
await canvas.screenshot({ path: 'e2e/.proof/globe.png' });
console.log('    screenshot: e2e/.proof/globe.png');
const appErrors = errors.filter((e) => !/favicon|fontawesome/i.test(e));
ok(appErrors.length === 0, `console clean (${appErrors.length}): ${appErrors.slice(0, 2).join(' | ')}`);

console.log('\n[G.fallback] geo fetch blocked → labeled fallback + log line');
const page2 = await ctx.newPage();
const logs2 = [];
page2.on('console', (m) => logs2.push(m.text()));
await page2.route('**/geo/land-50m.json', (r) => r.abort());
await page2.goto(`${BASE}/analytics`, { waitUntil: 'networkidle' });
const canvas2 = page2.locator('canvas[aria-label*="globe" i]').first();
await canvas2.waitFor({ state: 'visible', timeout: 15000 });
await page2.waitForTimeout(2500);
await canvas2.screenshot({ path: 'e2e/.proof/globe-fallback.png' });
console.log('    screenshot: e2e/.proof/globe-fallback.png');
ok(logs2.some((l) => l.includes('[globe] GEO LOAD FAILED')), 'console logged [globe] GEO LOAD FAILED');

const u = await sql`SELECT id FROM "user" WHERE email=${email}`;
if (u[0]) { await sql`DELETE FROM session WHERE "userId"=${u[0].id}`; await sql`DELETE FROM account WHERE "userId"=${u[0].id}`; await sql`DELETE FROM "user" WHERE id=${u[0].id}`; }
await browser.close();

console.log(`\nGLOBE GEO VERIFY: ${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
