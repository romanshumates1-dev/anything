// INT-3 gate evidence (MVP v2). Verifies, with observed output, that the
// number-pool surface is wired END TO END (no ghost UI):
//   1. admin GET/POST/PATCH /api/settings/number-pool round-trip
//   2. anon access -> 401/403
//   3. the settings page renders the pool card, the added number appears in
//      the table, and saving a cap lands a number_pool_cap_changed Event Log row
//   4. cleanup (test rows removed)
//   node --env-file=.env scripts/int3-verify.mjs
import { chromium } from '@playwright/test';
import { neon } from '@neondatabase/serverless';

const BASE = 'http://localhost:4000';
const sql = neon(process.env.DATABASE_URL);
const email = `int3-${Date.now()}@dealswiftautomation.com`;
const TEST_NUMBER = '+15025550188';
let failures = 0;
const ok = (c, m) => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) failures++; };

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
await ctx.request.post(`${BASE}/api/auth/sign-up/email`, {
  data: { email, password: 'Str0ngPass!234', name: 'INT3 Verify' }, headers: { 'content-type': 'application/json' },
});
await sql`UPDATE "user" SET role='ADMIN' WHERE email=${email}`;

// ── 1. admin API round-trip ───────────────────────────────────────────────────
console.log('\n[1] admin GET/POST/PATCH /api/settings/number-pool');
const g0 = await ctx.request.get(`${BASE}/api/settings/number-pool`);
ok(g0.status() === 200, `GET -> ${g0.status()}`);
const before = await g0.json();
console.log('   ', JSON.stringify({ rotationCap: before.rotationCap, numbers: before.numbers.length }));

const p1 = await ctx.request.post(`${BASE}/api/settings/number-pool`, {
  data: { phoneNumber: TEST_NUMBER }, headers: { 'content-type': 'application/json' },
});
ok(p1.status() === 201, `POST ${TEST_NUMBER} -> ${p1.status()}`);
const afterAdd = await p1.json();
const row = afterAdd.numbers.find((n) => n.phoneNumber === TEST_NUMBER);
ok(!!row, 'added number present in usage table');
ok(row?.areaCode === '502', `area code derived -> ${row?.areaCode}`);
ok(row?.cap?.rotationCap !== undefined && row?.cap?.carrierCap !== undefined,
   `BOTH caps visible per-number: rotation=${row?.cap?.rotationCap} carrier=${row?.cap?.carrierCap} (limitedBy ${row?.cap?.limitedBy})`);

const bad = await ctx.request.post(`${BASE}/api/settings/number-pool`, {
  data: { phoneNumber: 'not-a-number' }, headers: { 'content-type': 'application/json' },
});
ok(bad.status() === 400, `malformed number rejected -> ${bad.status()}`);

const patch = await ctx.request.patch(`${BASE}/api/settings/number-pool`, {
  data: { rotationCap: 90 }, headers: { 'content-type': 'application/json' },
});
ok(patch.status() === 200, `PATCH rotationCap 90 -> ${patch.status()}`);
const afterCap = await patch.json();
ok(afterCap.rotationCap === 90, `rotationCap persisted -> ${afterCap.rotationCap}`);
const capRow = afterCap.numbers.find((n) => n.phoneNumber === TEST_NUMBER);
ok(capRow?.cap?.effective === 90, `effective cap follows the guard -> ${capRow?.cap?.effective}`);

const badCap = await ctx.request.patch(`${BASE}/api/settings/number-pool`, {
  data: { rotationCap: -5 }, headers: { 'content-type': 'application/json' },
});
ok(badCap.status() === 400, `negative cap rejected -> ${badCap.status()}`);

// ── 2. anon is locked out ─────────────────────────────────────────────────────
console.log('\n[2] anon access');
const anonCtx = await browser.newContext();
const anon = await anonCtx.request.get(`${BASE}/api/settings/number-pool`);
ok(anon.status() === 401 || anon.status() === 403, `anon GET -> ${anon.status()}`);
await anonCtx.close();

// ── 3. UI wired end-to-end ────────────────────────────────────────────────────
console.log('\n[3] settings page: pool card renders with live data');
const errors = [];
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
ok(await page.getByText('Local Presence Number Pool').first().isVisible().catch(() => false), 'pool card renders');
ok(await page.locator('[data-testid="pool-table"]').isVisible().catch(() => false), 'usage table renders');
ok(await page.getByText(TEST_NUMBER).first().isVisible().catch(() => false), `added number ${TEST_NUMBER} visible in the UI table`);

// Event Log rows written by the API (no ghost surfaces: changes are audited)
const evs = await sql`
  SELECT action FROM audit_logs
  WHERE action IN ('number_pool_added','number_pool_cap_changed')
  AND created_at > now() - interval '5 minutes'
`;
ok(evs.some((e) => e.action === 'number_pool_added'), 'number_pool_added Event Log row exists');
ok(evs.some((e) => e.action === 'number_pool_cap_changed'), 'number_pool_cap_changed Event Log row exists');

console.log('\n[console errors]', errors.length, errors.slice(0, 4));
ok(errors.length === 0, 'zero console errors');

// ── 4. cleanup ────────────────────────────────────────────────────────────────
await sql`DELETE FROM number_pool WHERE phone_number = ${TEST_NUMBER}`;
await sql`DELETE FROM app_settings WHERE key='number_pool'`;
const u = await sql`SELECT id FROM "user" WHERE email=${email}`;
if (u[0]) { await sql`DELETE FROM session WHERE "userId"=${u[0].id}`; await sql`DELETE FROM account WHERE "userId"=${u[0].id}`; await sql`DELETE FROM "user" WHERE id=${u[0].id}`; }
await browser.close();

console.log(`\nINT-3 VERIFY: ${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
