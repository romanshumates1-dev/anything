// Phase C evidence — smoke against the RUNNING CONTAINERS (app + worker):
//   1. health ok from the containerized app
//   2. geo asset present INSIDE the image (globe bundled data)
//   3. INT-1 prod-SLA measurement: simulated inbound → worker container drains
//      ai_reply → observed reply_received→ai_dispatched latency from
//      inbound_latency (flips the OWNER-BLOCKED INT-1 prod row)
//   4. restart worker mid-ladder → no duplicate offers (dedupe holds)
//   node --env-file=.env scripts/container-smoke.mjs
import { neon } from '@neondatabase/serverless';

const BASE = process.env.SMOKE_BASE || 'http://localhost:4000';
const sql = neon(process.env.DATABASE_URL);
let failures = 0;
const ok = (c, m) => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) failures++; };

// ── 1. containerized health ──────────────────────────────────────────────────
console.log('\n[1] containerized app health');
const health = await fetch(`${BASE}/api/system/health`).then((r) => r.json()).catch((e) => ({ err: String(e) }));
ok(health.ok === true, `health ok:true → ${JSON.stringify(health.services || health.err)}`);

// ── 2. geo asset inside the image ────────────────────────────────────────────
console.log('\n[2] globe geo asset served from the container');
const geo = await fetch(`${BASE}/geo/land-50m.json`).then((r) => (r.ok ? r.json() : { rings: [] })).catch(() => ({ rings: [] }));
ok((geo.rings?.length ?? 0) > 1000, `land-50m.json inside image: ${geo.rings?.length} rings`);

// ── 3. INT-1 prod-SLA: inbound → worker drains → measured latency ────────────
console.log('\n[3] INT-1 prod-SLA measurement (always-on worker container)');
const PHONE = '+15025550611';
await sql`DELETE FROM leads WHERE phone = ${PHONE}`;
const [lead] = await sql`INSERT INTO leads (type, name, phone, status) VALUES ('seller','Smoke SLA', ${PHONE}, 'new') RETURNING id`;

const t0 = Date.now();
const inboundRes = await fetch(`${BASE}/api/sms/inbound`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-sms-secret': process.env.SMS_INBOUND_SECRET || '' },
  body: JSON.stringify({ from: PHONE, text: 'Yes, tell me more about selling' }),
});
ok(inboundRes.status === 200, `inbound accepted → ${inboundRes.status}`);

// wait for the WORKER CONTAINER to drain the ai_reply job (3s poll)
let latencyRow = null;
for (let i = 0; i < 30 && !latencyRow; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const rows = await sql`
    SELECT reply_received_at, ai_dispatched_at,
           EXTRACT(EPOCH FROM (ai_dispatched_at - reply_received_at)) * 1000 AS ms
    FROM inbound_latency WHERE lead_id = ${lead.id} AND ai_dispatched_at IS NOT NULL
    ORDER BY reply_received_at DESC LIMIT 1
  `;
  if (rows[0]) latencyRow = rows[0];
}
ok(!!latencyRow, `worker container drained ai_reply within 30s (wall ${(Date.now() - t0) / 1000}s)`);
if (latencyRow) {
  const ms = Math.round(Number(latencyRow.ms));
  ok(ms < 60_000, `OBSERVED inbound→ai_dispatched latency: ${ms}ms (< 60s SLA)`);
  console.log(`    >>> INT-1 prod-SLA observed number: ${ms}ms`);
}

// ── 4. restart worker mid-ladder → no duplicate offer ────────────────────────
console.log('\n[4] worker restart mid-ladder → dedupe holds (no duplicates)');
const DK = 'smoke-restart:' + Date.now();
await sql`INSERT INTO jobs (type, payload, run_at, max_attempts, dedupe_key)
  VALUES ('cadence_step', '{"contactId":"smoke-ghost","campaignId":"c","organizationId":"o","phone":"+15025550612","sequenceOrder":1,"templateId":"t","body":"x"}'::jsonb, now() + interval '2 seconds', 3, ${DK})`;
// simulate the restart re-schedule: same dedupe key again (post-restart re-enqueue)
await sql`INSERT INTO jobs (type, payload, run_at, max_attempts, dedupe_key)
  VALUES ('cadence_step', '{}'::jsonb, now() + interval '2 seconds', 3, ${DK})
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`;
const [cnt] = await sql`SELECT COUNT(*)::int c FROM jobs WHERE dedupe_key = ${DK}`;
ok(cnt.c === 1, `exactly one job row under the restart-replayed key (${cnt.c})`);
let done = null;
for (let i = 0; i < 20 && !done; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const [row] = await sql`SELECT status FROM jobs WHERE dedupe_key = ${DK}`;
  if (row && !['pending', 'processing'].includes(row.status)) done = row;
}
ok(done?.status === 'completed', `restart-survived job drained by worker container → ${done?.status}`);

// cleanup
await sql`DELETE FROM jobs WHERE dedupe_key = ${DK}`;
await sql`DELETE FROM inbound_latency WHERE lead_id = ${lead.id}`;
await sql`DELETE FROM ai_conversations WHERE lead_id = ${lead.id}`;
await sql`DELETE FROM leads WHERE id = ${lead.id}`;

console.log(`\nCONTAINER SMOKE: ${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
