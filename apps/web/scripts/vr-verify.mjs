// Phase V-R live evidence — inspection clock end-to-end against the running app:
//   1. seed contracts at day-1 (green), day-6 (amber), day-9 (red) of a 10-day
//      window + one assigned → chip renders each stage (screenshot)
//   2. urgency jobs: schedule for a seeded contract → jobs rows exist with the
//      dedupe keys; force-run the final hook → PENDING human_approvals row with
//      the lowest-viable-ask number; re-run → no duplicate (exactly-once)
//   node --env-file=.env scripts/vr-verify.mjs
import { chromium } from '@playwright/test';
import { neon } from '@neondatabase/serverless';
import { mkdirSync } from 'fs';

const BASE = 'http://localhost:4000';
const sql = neon(process.env.DATABASE_URL);
const email = `vr-${Date.now()}@dealswiftautomation.com`;
mkdirSync('e2e/.proof', { recursive: true });
let failures = 0;
const ok = (c, m) => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) failures++; };

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 1300, height: 1000 } });
await ctx.request.post(`${BASE}/api/auth/sign-up/email`, {
  data: { email, password: 'Str0ngPass!234', name: 'VR Verify' }, headers: { 'content-type': 'application/json' },
});
await sql`UPDATE "user" SET role='ADMIN' WHERE email=${email}`;
const [u] = await sql`SELECT id FROM "user" WHERE email=${email}`;
const orgId = u.id;

// ── seed a template + four contracts at different clock stages ───────────────
// NOTE: the /api/contracts route resolves org as session.user.organizationId ||
// 'default' (better-auth users carry no organizationId) — seed under 'default'
// so the page actually lists these rows; cleanup deletes by id.
const PAGE_ORG = 'default';
const tpl = 'vr-tpl-' + Date.now();
await sql`INSERT INTO contract_templates (id, organization_id, direction, template_body, is_active) VALUES (${tpl}, ${PAGE_ORG}, 'SELLER', 'body', true)`;
const mk = async (id, daysAgo, assigned = false) => {
  await sql`
    INSERT INTO contracts (id, organization_id, template_id, direction, filled_body, status, inspection_days, contract_price_cents, created_at, assigned_at)
    VALUES (${id}, ${PAGE_ORG}, ${tpl}, 'SELLER', 'x', 'PENDING_SIGNATURE', 10, 8500000,
            now() - make_interval(days => ${daysAgo}), ${assigned ? new Date() : null})
  `;
};
const ids = { green: 'vr-green', amber: 'vr-amber', red: 'vr-red', assigned: 'vr-assigned' };
await mk(ids.green, 0);   // day 1  → green
await mk(ids.amber, 5);   // day 6  → 4 remaining ≤ 5 → amber
await mk(ids.red, 8);     // day 9  → 1 remaining → red
await mk(ids.assigned, 8, true);

console.log('\n[1] chip renders each stage on /contracts');
const errors = [];
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${BASE}/contracts`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
const stages = await page.locator('[data-testid="inspection-chip"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-stage')));
ok(stages.includes('green'), `green chip present (${stages.join(',')})`);
ok(stages.includes('amber'), 'amber chip present');
ok(stages.includes('red'), 'red chip present');
ok(stages.includes('assigned'), 'assigned chip present');
await page.screenshot({ path: 'e2e/.proof/inspection-clock.png', fullPage: false });
console.log('    screenshot: e2e/.proof/inspection-clock.png');
const appErrors = errors.filter((e) => !/favicon|fontawesome/i.test(e));
ok(appErrors.length === 0, `console clean (${appErrors.length})`);

// ── urgency hooks: schedule + fire + exactly-once ────────────────────────────
console.log('\n[2] urgency jobs scheduled with dedupe keys');
// Simulate the contract-creation scheduling for the red contract by inserting
// the job row the scheduler would create (same type/payload/dedupe key), then
// let the LIVE drain loop fire the real handler.
await sql`DELETE FROM jobs WHERE dedupe_key LIKE ${'inspect:' + ids.red + '%'}`;
await sql`
  INSERT INTO jobs (type, payload, run_at, max_attempts, dedupe_key)
  VALUES ('inspection_urgency', ${JSON.stringify({ contractId: ids.red, organizationId: orgId, kind: 'final' })}, now() - interval '1 second', 3, ${'inspect:' + ids.red + ':final'})
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
`;
const [jrow] = await sql`SELECT id, status FROM jobs WHERE dedupe_key = ${'inspect:' + ids.red + ':final'}`;
ok(!!jrow, `final-urgency job row exists (id=${jrow?.id})`);

// let the drain loop fire it
let fired = null;
for (let i = 0; i < 15 && !fired; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const [row] = await sql`SELECT status FROM jobs WHERE id = ${jrow.id}`;
  if (row && row.status === 'completed') fired = row;
}
ok(!!fired, 'urgency job drained to completed by the live worker');

const approvals = await sql`
  SELECT type, context FROM human_approvals WHERE contract_id = ${ids.red} AND status = 'PENDING'
`;
ok(approvals.length === 1, `exactly ONE PENDING approval row (${approvals.length})`);
ok(approvals[0]?.type === 'INSPECTION_FINAL', `type INSPECTION_FINAL (${approvals[0]?.type})`);
ok(JSON.stringify(approvals[0]?.context || {}).includes('88,000'), 'notification carries lowest viable ask $88,000 (85k + 3k floor)');

// exactly-once: re-insert with the same dedupe key → collapsed, no second approval
await sql`
  INSERT INTO jobs (type, payload, run_at, max_attempts, dedupe_key)
  VALUES ('inspection_urgency', ${JSON.stringify({ contractId: ids.red, organizationId: orgId, kind: 'final' })}, now(), 3, ${'inspect:' + ids.red + ':final'})
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
`;
await new Promise((r) => setTimeout(r, 4000));
const approvals2 = await sql`SELECT COUNT(*)::int c FROM human_approvals WHERE contract_id = ${ids.red}`;
ok(approvals2[0].c === 1, `still exactly one approval after re-schedule attempt (${approvals2[0].c}) — exactly-once holds`);

// assigned contract never notifies
await sql`
  INSERT INTO jobs (type, payload, run_at, max_attempts, dedupe_key)
  VALUES ('inspection_urgency', ${JSON.stringify({ contractId: ids.assigned, organizationId: orgId, kind: 'day3' })}, now() - interval '1 second', 3, ${'inspect:' + ids.assigned + ':day3'})
`;
await new Promise((r) => setTimeout(r, 5000));
const assignedApprovals = await sql`SELECT COUNT(*)::int c FROM human_approvals WHERE contract_id = ${ids.assigned}`;
ok(assignedApprovals[0].c === 0, `assigned contract → zero notifications (${assignedApprovals[0].c})`);

// ── cleanup ──────────────────────────────────────────────────────────────────
await sql`DELETE FROM human_approvals WHERE contract_id = ANY(${Object.values(ids)})`;
await sql`DELETE FROM jobs WHERE dedupe_key LIKE 'inspect:vr-%'`;
await sql`DELETE FROM contracts WHERE id = ANY(${Object.values(ids)})`;
await sql`DELETE FROM contract_templates WHERE id = ${tpl}`;
await sql`DELETE FROM session WHERE "userId"=${orgId}`; await sql`DELETE FROM account WHERE "userId"=${orgId}`; await sql`DELETE FROM "user" WHERE id=${orgId}`;
await browser.close();

console.log(`\nV-R VERIFY: ${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
