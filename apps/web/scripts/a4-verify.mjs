// Phase A.4 live evidence — negotiation panel end-to-end (no ghost UI):
//   1. flag OFF → panel NOT rendered on the lead thread
//   2. flag ON + a seeded active session → timeline shows round/opener/clamp;
//      Pause button cancels a queued negoffer job and flips status to paused
//   node --env-file=.env scripts/a4-verify.mjs
import { chromium } from '@playwright/test';
import { neon } from '@neondatabase/serverless';
import { mkdirSync } from 'fs';
import crypto from 'crypto';

const BASE = 'http://localhost:4000';
const sql = neon(process.env.DATABASE_URL);
const email = `a4-${Date.now()}@dealswiftautomation.com`;
mkdirSync('e2e/.proof', { recursive: true });
let failures = 0;
const ok = (c, m) => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) failures++; };

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 1000 } });
await ctx.request.post(`${BASE}/api/auth/sign-up/email`, {
  data: { email, password: 'Str0ngPass!234', name: 'A4' }, headers: { 'content-type': 'application/json' },
});
await sql`UPDATE "user" SET role='ADMIN' WHERE email=${email}`;
const [u] = await sql`SELECT id FROM "user" WHERE email=${email}`;
const orgId = u.id;

// seed a lead + an active seller session mid-negotiation
const leadRows = await sql`INSERT INTO leads (type, name, phone, status) VALUES ('seller', 'A4 Lead', '+15025550444', 'new') RETURNING id`;
const leadId = leadRows[0].id;
const sessionId = crypto.randomUUID();
await sql`
  INSERT INTO negotiation_sessions (id, organization_id, lead_id, side, status, round, opener_cents, clamp_cents, approved_min_cents, approved_max_cents, last_offer_cents, last_counter_cents)
  VALUES (${sessionId}, ${orgId}, ${leadId}, 'seller', 'active', 2, 7380000, 9700000, 7380000, 9700000, 8100000, 12000000)
`;
// a queued offer job the pause must cancel
await sql`
  INSERT INTO jobs (type, payload, run_at, max_attempts, dedupe_key, status)
  VALUES ('send_message', ${JSON.stringify({ leadId, to: '+15025550444', text: 'x', channel: 'sms' })}, now() + interval '1 hour', 3, ${'negoffer:' + sessionId + ':2'}, 'pending')
`;

// ── 1. flag OFF → panel hidden ───────────────────────────────────────────────
console.log('\n[1] flag OFF → panel not rendered (no ghost UI)');
await sql`DELETE FROM app_settings WHERE key='beta_flags'`;
const errors = [];
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${BASE}/inbox/${leadId}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
ok(!(await page.locator('[data-testid="negotiation-panel"]').isVisible().catch(() => false)), 'panel hidden when flag off');

// ── 2. flag ON → timeline + pause ────────────────────────────────────────────
console.log('\n[2] flag ON → timeline renders + pause cancels queue');
await ctx.request.patch(`${BASE}/api/settings/beta-flags`, {
  data: { boundedNegotiation: true }, headers: { 'content-type': 'application/json' },
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
ok(await page.locator('[data-testid="negotiation-panel"]').isVisible().catch(() => false), 'panel renders when flag on');
ok(await page.locator('[data-testid="negotiation-timeline"]').isVisible().catch(() => false), 'timeline renders');
const timelineText = await page.locator('[data-testid="negotiation-timeline"]').textContent().catch(() => '');
ok(/\$97,000/.test(timelineText || ''), `ceiling (clamp) shown: ${/\$97,000/.test(timelineText||'') ? '$97,000' : timelineText?.slice(0,60)}`);
ok(/\$81,000/.test(timelineText || ''), 'last offer $81,000 shown');
await page.screenshot({ path: 'e2e/.proof/negotiation-panel.png' });
console.log('    screenshot: e2e/.proof/negotiation-panel.png');

// pause → cancels the queued job, flips to paused
const pauseBtn = page.locator('[data-testid="negotiation-pause"]');
ok(await pauseBtn.isVisible().catch(() => false), 'pause button visible for active session');
await page.waitForTimeout(500);
await pauseBtn.click({ force: true });
// wait for the pause POST to land (poll the DB rather than a fixed sleep)
for (let i = 0; i < 12; i++) {
  const [s] = await sql`SELECT status FROM negotiation_sessions WHERE id = ${sessionId}`;
  if (s?.status === 'paused') break;
  await page.waitForTimeout(500);
}
const [jobRow] = await sql`SELECT status FROM jobs WHERE dedupe_key = ${'negoffer:' + sessionId + ':2'}`;
ok(jobRow?.status === 'cancelled', `queued offer job cancelled by pause (${jobRow?.status})`);
const [sess] = await sql`SELECT status FROM negotiation_sessions WHERE id = ${sessionId}`;
ok(sess?.status === 'paused', `session status → paused (${sess?.status})`);

const appErrors = errors.filter((e) => !/favicon|fontawesome/i.test(e));
ok(appErrors.length === 0, `console clean (${appErrors.length})`);

// cleanup
await sql`DELETE FROM jobs WHERE dedupe_key LIKE ${'negoffer:' + sessionId + '%'}`;
await sql`DELETE FROM negotiation_sessions WHERE id = ${sessionId}`;
await sql`DELETE FROM leads WHERE id = ${leadId}`;
await sql`DELETE FROM app_settings WHERE key='beta_flags'`;
await sql`DELETE FROM session WHERE "userId"=${orgId}`; await sql`DELETE FROM account WHERE "userId"=${orgId}`; await sql`DELETE FROM "user" WHERE id=${orgId}`;
await browser.close();

console.log(`\nA.4 VERIFY: ${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
