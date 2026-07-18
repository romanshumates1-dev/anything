// P1 gate evidence (MVP v2). Verifies, with observed output:
//   1. /api/system/health reports all services ok
//   2. toggling EACH beta flag is reflected in /api/health within 1s
//   3. dashboard + settings render with ZERO console errors
//   4. Beta Flags panel + Event Log panel are actually wired (not ghost UI)
//   node --env-file=.env scripts/p1-verify.mjs
import { chromium } from '@playwright/test';
import { neon } from '@neondatabase/serverless';
import { mkdirSync } from 'fs';

const BASE = 'http://localhost:4000';
const sql = neon(process.env.DATABASE_URL);
const email = `p1-${Date.now()}@dealswiftautomation.com`;
const FLAGS = ['speedToLead', 'voiceEscalation', 'localPresence', 'cadenceEngine', 'negotiationProfiles', 'boundedNegotiation', 'twilioDemo'];
let failures = 0;
const ok = (c, m) => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) failures++; };

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
await ctx.request.post(`${BASE}/api/auth/sign-up/email`, {
  data: { email, password: 'Str0ngPass!234', name: 'P1 Verify' }, headers: { 'content-type': 'application/json' },
});
await sql`UPDATE "user" SET role='ADMIN' WHERE email=${email}`;

// ── 1. health: liveness only, all services ok, ZERO config ───────────────────
console.log('\n[1] /api/system/health (public — liveness only)');
const h = await (await ctx.request.get(`${BASE}/api/system/health`)).json();
console.log('   ', JSON.stringify(h));
ok(h.ok === true, 'health ok:true');
for (const s of ['db', 'jobs', 'ai', 'sms']) ok(h.services?.[s] === true, `service ${s} ok`);
// The public probe is unauthenticated + internet-facing in prod: it must not
// publish feature/vendor config. Assert the leak stays closed.
for (const leak of ['betaFlags', 'drivers', 'database', 'twilio']) {
  ok(h[leak] === undefined, `public health does NOT expose ${leak}`);
}

// ── 2. each flag toggles + is reflected within 1s (ADMIN route) ──────────────
console.log('\n[2] beta flag toggle -> /api/settings/beta-flags within 1s');
// Flags moved off public health (config), so propagation is measured on the
// admin route that actually serves them.
// Warm the routes first: in dev, the FIRST hit on a route pays Turbopack
// compilation (measured ~1.1s vs ~0.47s warm), which would measure the
// compiler, not flag propagation. The gate is about propagation latency.
await ctx.request.patch(`${BASE}/api/settings/beta-flags`, {
  data: { speedToLead: false }, headers: { 'content-type': 'application/json' },
});
await ctx.request.get(`${BASE}/api/settings/beta-flags`);

for (const f of FLAGS) {
  const t0 = Date.now();
  await ctx.request.patch(`${BASE}/api/settings/beta-flags`, {
    data: { [f]: true }, headers: { 'content-type': 'application/json' },
  });
  const after = await (await ctx.request.get(`${BASE}/api/settings/beta-flags`)).json();
  const ms = Date.now() - t0;
  ok((after.flags?.[f] ?? after[f]) === true && ms < 1000, `${f} ON reflected in ${ms}ms`);
  // restore OFF (default-safe state)
  await ctx.request.patch(`${BASE}/api/settings/beta-flags`, {
    data: { [f]: false }, headers: { 'content-type': 'application/json' },
  });
  const back = await (await ctx.request.get(`${BASE}/api/settings/beta-flags`)).json();
  ok((back.flags?.[f] ?? back[f]) === false, `${f} restored OFF`);
}

// ── 2b. flags are NOT readable without an admin session ─────────────────────
console.log('\n[2b] /api/settings/beta-flags requires admin');
const anon = await ctx.request.get(`${BASE}/api/settings/beta-flags`, { headers: { cookie: '' } });
ok(anon.status() === 401 || anon.status() === 403, `anon flags read -> ${anon.status()}`);

// ── 3 + 4. pages render, zero console errors, panels wired ───────────────────
console.log('\n[3] dashboard + settings render, zero console errors');
const errors = [];
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
ok((await page.locator('h1').first().textContent().catch(() => '')) !== '', 'dashboard renders a heading');

await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
const hasFlags = await page.getByText('Beta Integrations').first().isVisible().catch(() => false);
const hasLog = await page.getByText('Event Log').first().isVisible().catch(() => false);
ok(hasFlags, 'Beta Integrations panel renders');
ok(hasLog, 'Event Log panel renders');

// 4. wired end-to-end: flip a flag IN THE UI, assert an event lands in the log
console.log('\n[4] UI flag toggle -> Event Log entry (no ghost features)');
const sw = page.getByRole('switch', { name: /Speed-to-Lead/i }).first();
if (await sw.isVisible().catch(() => false)) {
  await sw.click();
  await page.waitForTimeout(2500);
  const logged = await page.getByText('beta_flag_changed').first().isVisible().catch(() => false);
  ok(logged, 'UI toggle produced a beta_flag_changed Event Log row');
  await sw.click(); // restore off
  await page.waitForTimeout(1200);
} else {
  ok(false, 'Speed-to-Lead switch not found in UI');
}

console.log('\n[console errors]', errors.length, errors.slice(0, 4));
ok(errors.length === 0, 'zero console errors');

mkdirSync('e2e/.proof', { recursive: true });
await page.screenshot({ path: 'e2e/.proof/p1-settings-beta-flags.png', fullPage: false });
console.log('screenshot: e2e/.proof/p1-settings-beta-flags.png');

// cleanup: flags off + remove the verify admin
await sql`DELETE FROM app_settings WHERE key='beta_flags'`;
const u = await sql`SELECT id FROM "user" WHERE email=${email}`;
if (u[0]) { await sql`DELETE FROM session WHERE "userId"=${u[0].id}`; await sql`DELETE FROM account WHERE "userId"=${u[0].id}`; await sql`DELETE FROM "user" WHERE id=${u[0].id}`; }
await browser.close();

console.log(`\nP1 VERIFY: ${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
