// P3 live-server evidence (MVP v2). Three owner-mandated behaviours against the
// RUNNING stack (not mocks):
//   1. RESTART-RESUME — a cadence job written straight to the durable jobs table
//      is picked up and processed by the server's drain loop (a DIFFERENT
//      process). The queue IS the state; nothing lives in memory a restart loses.
//   2. FLAGS OFF ⇒ ZERO EVENTS — with cadenceEngine OFF the drained step
//      completes as flag_off: no send_message enqueued, no outbound events.
//   3. OPT-OUT SUPPRESSION — a suppressed number gets nothing, even on the
//      transactional OTP path, through the real gateway (DNC ≻ everything).
//   node --env-file=.env scripts/p3-verify.mjs
import { chromium } from '@playwright/test';
import { neon } from '@neondatabase/serverless';

const BASE = 'http://localhost:4000';
const sql = neon(process.env.DATABASE_URL);
const email = `p3-${Date.now()}@dealswiftautomation.com`;
const OPTOUT_NUMBER = '+15025550977';
const DEDUPE = `p3-verify:${Date.now()}`;
let failures = 0;
const ok = (c, m) => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) failures++; };

const t0 = new Date();

// ── 1+2. restart-resume + flags-off ─────────────────────────────────────────
console.log('\n[1] restart-resume: durable job -> fresh drain cycle');
const flags = await sql`SELECT value FROM app_settings WHERE key='beta_flags'`;
ok(!(flags[0]?.value?.cadenceEngine), `precondition: cadenceEngine flag is OFF (${JSON.stringify(flags[0]?.value ?? 'unset')})`);

const [job] = await sql`
  INSERT INTO jobs (type, payload, run_at, max_attempts, dedupe_key)
  VALUES ('cadence_step', ${JSON.stringify({ contactId: 'p3-ghost', campaignId: 'p3-camp', organizationId: 'p3-org', phone: '+15025550966', sequenceOrder: 1, templateId: 't', body: 'p3' })},
          now() - interval '1 second', 3, ${DEDUPE})
  RETURNING id
`;
console.log(`    inserted pending cadence_step job id=${job.id} (simulating pre-restart state)`);

let drained = null;
for (let i = 0; i < 15 && !drained; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const [row] = await sql`SELECT status, error_message FROM jobs WHERE id = ${job.id}`;
  if (row && row.status !== 'pending' && row.status !== 'processing') drained = row;
}
ok(!!drained, `job drained by the server's loop within 15s -> ${JSON.stringify(drained)}`);
ok(drained?.status === 'completed', `deferred/complete (not dead-lettered): status=${drained?.status}`);

console.log('\n[2] flags OFF => zero outbound events from that step');
const sends = await sql`
  SELECT COUNT(*)::int c FROM jobs
  WHERE type = 'send_message' AND payload->>'contactId' = 'p3-ghost'
`;
ok(sends[0].c === 0, `zero send_message jobs enqueued by the flag-off step (${sends[0].c})`);
const events = await sql`
  SELECT COUNT(*)::int c FROM audit_logs
  WHERE action IN ('cadence_step_sent','voice_call_dispatched','message_sent')
    AND created_at >= ${t0}
    AND (payload->>'campaignId' = 'p3-camp' OR target_id = 'p3-ghost')
`;
ok(events[0].c === 0, `zero outbound audit events for the ghost campaign (${events[0].c})`);

// ── 3. opt-out suppression through the LIVE gateway ─────────────────────────
console.log('\n[3] DNC beats everything — even the transactional OTP path');
await sql`
  INSERT INTO compliance_records (target, type, channel, metadata)
  VALUES (${OPTOUT_NUMBER}, 'opt-out', 'sms', '{"source":"p3-verify"}')
  ON CONFLICT (target, channel, type) DO UPDATE SET created_at = CURRENT_TIMESTAMP
`;

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' });
const ctx = await browser.newContext();
await ctx.request.post(`${BASE}/api/auth/sign-up/email`, {
  data: { email, password: 'Str0ngPass!234', name: 'P3 Verify' }, headers: { 'content-type': 'application/json' },
});
await sql`UPDATE "user" SET role='ADMIN' WHERE email=${email}`;

const otp = await ctx.request.post(`${BASE}/api/test-phones`, {
  data: { phone: OPTOUT_NUMBER }, headers: { 'content-type': 'application/json' },
});
const otpBody = await otp.json().catch(() => ({}));
ok(otp.status() === 409, `OTP to a suppressed number -> ${otp.status()} (${JSON.stringify(otpBody)})`);
ok(String(otpBody.error || '').toLowerCase().includes('opted out'), 'error names the reason (opted out)');

// ── cleanup ──────────────────────────────────────────────────────────────────
await sql`DELETE FROM jobs WHERE dedupe_key = ${DEDUPE}`;
await sql`DELETE FROM compliance_records WHERE target = ${OPTOUT_NUMBER} AND metadata->>'source' = 'p3-verify'`;
try { await sql`DELETE FROM test_phone_numbers WHERE phone = ${OPTOUT_NUMBER}`; } catch {}
const u = await sql`SELECT id FROM "user" WHERE email=${email}`;
if (u[0]) { await sql`DELETE FROM session WHERE "userId"=${u[0].id}`; await sql`DELETE FROM account WHERE "userId"=${u[0].id}`; await sql`DELETE FROM "user" WHERE id=${u[0].id}`; }
await browser.close();

console.log(`\nP3 VERIFY: ${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
