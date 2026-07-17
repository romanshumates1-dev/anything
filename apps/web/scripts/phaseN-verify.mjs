// Phase N live evidence — negotiation profiles wired end-to-end (no ghost UI).
//   1. flag OFF → API 403 AND the settings card renders nothing
//   2. flag ON  → GET lists the 3 seeds; preview computes owner-suggested range
//   3. luxury preview shows the manual-comps / no-cold posture
//   4. create + validation; Event Log row on create
//   node --env-file=.env scripts/phaseN-verify.mjs
import { chromium } from '@playwright/test';
import { neon } from '@neondatabase/serverless';

const BASE = 'http://localhost:4000';
const sql = neon(process.env.DATABASE_URL);
const email = `pn-${Date.now()}@dealswiftautomation.com`;
let failures = 0;
const ok = (c, m) => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) failures++; };

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
await ctx.request.post(`${BASE}/api/auth/sign-up/email`, {
  data: { email, password: 'Str0ngPass!234', name: 'PN Verify' }, headers: { 'content-type': 'application/json' },
});
await sql`UPDATE "user" SET role='ADMIN' WHERE email=${email}`;

// ── 1. flag OFF → 403 ────────────────────────────────────────────────────────
console.log('\n[1] flag OFF → API 403 + UI hidden');
await sql`DELETE FROM app_settings WHERE key='beta_flags'`;
const off = await ctx.request.get(`${BASE}/api/negotiation/profiles`);
ok(off.status() === 403, `GET profiles (flag off) → ${off.status()}`);

const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
// Target the CARD by testid — the string "Negotiation Profiles" also appears as
// a flag toggle label in BetaFlagsCard, so text matching would be a false hit.
ok(!(await page.locator('[data-testid="negotiation-profiles-card"]').isVisible().catch(() => false)),
   'profiles card NOT rendered when flag off (no ghost UI)');

// ── 2. flag ON → list + preview ──────────────────────────────────────────────
console.log('\n[2] flag ON → list 3 seeds + live preview');
await ctx.request.patch(`${BASE}/api/settings/beta-flags`, {
  data: { negotiationProfiles: true }, headers: { 'content-type': 'application/json' },
});
const list = await (await ctx.request.get(`${BASE}/api/negotiation/profiles`)).json();
ok(list.profiles?.length >= 3, `GET profiles → ${list.profiles?.length} profiles`);
ok(list.profiles?.some((p) => p.id === 'luxury_referral' && p.allowsColdOutbound === false),
   'luxury_referral present with allowsColdOutbound=false');

const prev = await (await ctx.request.post(`${BASE}/api/negotiation/preview`, {
  data: { profileId: 'standard_distressed', inputs: { arv: 200000, sqft: 1500, conditionTier: 'moderate', hasAvm: true, compsCount: 4 } },
  headers: { 'content-type': 'application/json' },
})).json();
ok(prev.valuation?.suggestMax === 73000 && prev.valuation?.suggestMin === 59860,
   `preview standard: min=${prev.valuation?.suggestMin} max=${prev.valuation?.suggestMax} (expect 59860/73000)`);
ok(prev.valuation?.confidence === 'HIGH', `confidence HIGH → ${prev.valuation?.confidence}`);
ok(Array.isArray(prev.valuation?.formulaTrace) && prev.valuation.formulaTrace.length > 0, 'formula trace present');

// foundation flag → escalate, no number
const esc = await (await ctx.request.post(`${BASE}/api/negotiation/preview`, {
  data: { profileId: 'standard_distressed', inputs: { arv: 200000, sqft: 1500, conditionTier: 'moderate', bigTicketFlags: ['foundation'], hasAvm: true, compsCount: 4 } },
  headers: { 'content-type': 'application/json' },
})).json();
ok(esc.valuation?.escalate === true && esc.valuation?.suggestMax === null,
   'foundation flag → escalate, no numeric suggestion');

// ── 3. UI renders with the flag on ───────────────────────────────────────────
console.log('\n[3] UI renders card + params when flag on');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
ok(await page.locator('[data-testid="negotiation-profiles-card"]').isVisible().catch(() => false), 'card renders');
ok(await page.getByText('you approve every range', { exact: false }).first().isVisible().catch(() => false),
   'invariant banner visible');

// ── 4. create + validation + Event Log ───────────────────────────────────────
console.log('\n[4] create + validation + Event Log');
const bad = await ctx.request.post(`${BASE}/api/negotiation/profiles`, {
  data: { name: 'Bad', arvMultiplier: 2, minFee: 1, feeTargetMax: 2, openerPctOfMax: 0.8 },
  headers: { 'content-type': 'application/json' },
});
ok(bad.status() === 400, `invalid arvMultiplier → ${bad.status()}`);

const created = await ctx.request.post(`${BASE}/api/negotiation/profiles`, {
  data: { name: 'PN Test Cash Buyers', segment: 'test', arvMultiplier: 0.68, repairModeratePsf: 35, minFee: 12000, feeTargetMax: 18000, openerPctOfMax: 0.8 },
  headers: { 'content-type': 'application/json' },
});
ok(created.status() === 201, `create valid → ${created.status()}`);
const ev = await sql`SELECT 1 FROM audit_logs WHERE action='negotiation_profile_created' AND created_at > now() - interval '2 minutes'`;
ok(ev.length > 0, 'negotiation_profile_created Event Log row exists');

console.log('\n[console errors]', errors.length, errors.slice(0, 4));
ok(errors.length === 0, 'zero console errors');

// cleanup
await sql`DELETE FROM negotiation_profiles WHERE id='pn_test_cash_buyers'`;
await sql`DELETE FROM app_settings WHERE key='beta_flags'`;
const u = await sql`SELECT id FROM "user" WHERE email=${email}`;
if (u[0]) { await sql`DELETE FROM session WHERE "userId"=${u[0].id}`; await sql`DELETE FROM account WHERE "userId"=${u[0].id}`; await sql`DELETE FROM "user" WHERE id=${u[0].id}`; }
await browser.close();

console.log(`\nPHASE N VERIFY: ${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
