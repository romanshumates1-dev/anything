#!/usr/bin/env node
/**
 * GATE 1 EVIDENCE — the cross-channel fan-out through the REAL HTTP ROUTE.
 *
 * Unit tests prove the function. This proves the running application: it POSTs
 * to /api/compliance/opt-out exactly as a provider webhook would, then reads
 * the database to confirm the fan-out actually happened in the live process.
 *
 * That distinction has already cost this project once — dnc_registry passed in
 * CI while not existing in the dev database. A green unit test is not evidence
 * that the deployed path works.
 *
 *   node --env-file=.env scripts/verify-optout-route-live.mjs
 */
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);
const BASE = process.env.PROBE_BASE_URL || 'http://localhost:4000';
const SECRET = process.env.SMS_INBOUND_SECRET;

const STAMP = String(Date.now()).slice(-7);
const PHONE = `+1502888${STAMP.slice(-4)}`;
const EMAIL = `route-probe-${STAMP}@dealflow-test.invalid`;
const MAIL = `${STAMP} Route Way, Louisville, KY 40202`;

let failures = 0;
const line = (s = '') => console.log(s);
function assert(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  line(`  ${ok ? '✅ PASS' : '❌ FAIL'}  ${label}`);
  line(`         expected=${expected}  actual=${actual}`);
}
const isSuppressed = async (t) =>
  (await sql`SELECT 1 FROM compliance_records WHERE target = ${t} AND type='opt-out' LIMIT 1`).length > 0;

async function cleanup(leadId) {
  await sql`DELETE FROM compliance_records WHERE target IN (${PHONE}, ${EMAIL}, ${MAIL})`;
  if (leadId) await sql`DELETE FROM leads WHERE id = ${leadId}`;
  else await sql`DELETE FROM leads WHERE email = ${EMAIL}`;
}

async function main() {
  line('═══════════════════════════════════════════════════════════════');
  line('  GATE 1 — CROSS-CHANNEL FAN-OUT THROUGH THE LIVE ROUTE');
  line('═══════════════════════════════════════════════════════════════');
  line(`  POST ${BASE}/api/compliance/opt-out`);
  line(`  phone=${PHONE}`);
  line(`  email=${EMAIL}`);
  line();

  if (!SECRET) {
    line('  ❌ SMS_INBOUND_SECRET not set — the route is secret-gated and will 401.');
    process.exit(1);
  }

  await cleanup(null);
  const [org] = await sql`SELECT id FROM organizations ORDER BY id LIMIT 1`;
  const [lead] = await sql`
    INSERT INTO leads (type, name, email, phone, status, source, metadata, organization_id)
    VALUES ('seller', 'Route Probe', ${EMAIL}, ${PHONE}, 'new', 'gate1-probe',
            ${JSON.stringify({ mailing_address: MAIL })}, ${org.id})
    RETURNING id
  `;
  line(`─── SEED: lead id=${lead.id} (phone + email + mailing address) ───`);
  line();

  line('─── LEG 1: BEFORE (non-vacuous — all reachable) ───────────────');
  assert('phone reachable', await isSuppressed(PHONE), false);
  assert('email reachable', await isSuppressed(EMAIL), false);
  assert('mail  reachable', await isSuppressed(MAIL), false);
  line();

  line('─── LEG 2: unauthenticated POST must be rejected ──────────────');
  const anon = await fetch(`${BASE}/api/compliance/opt-out`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target: EMAIL, channel: 'email', reason: 'probe' }),
  });
  assert('anonymous POST is 401', anon.status, 401);
  assert('nothing suppressed by the rejected call', await isSuppressed(EMAIL), false);
  line();

  line('─── LEG 3: authenticated EMAIL unsubscribe via the route ──────');
  const res = await fetch(`${BASE}/api/compliance/opt-out`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-sms-secret': SECRET },
    body: JSON.stringify({ target: EMAIL, channel: 'email', reason: 'list-unsubscribe' }),
  });
  const body = await res.json().catch(() => ({}));
  line(`  HTTP ${res.status} — ${JSON.stringify(body)}`);
  assert('route returns 200', res.status, 200);
  line();

  const rows = await sql`
    SELECT target, channel, metadata->>'fannedOut' AS fanned, metadata->>'leadId' AS lead_id
    FROM compliance_records
    WHERE target IN (${PHONE}, ${EMAIL}, ${MAIL}) AND type='opt-out'
    ORDER BY target
  `;
  line('  DB ROWS written by the LIVE process (compliance_records):');
  for (const r of rows) {
    line(`    target=${r.target}  channel=${r.channel}  fannedOut=${r.fanned}  leadId=${r.lead_id}`);
  }
  line();

  line('─── LEG 4: THE CLAIM — SMS + mail suppressed by an EMAIL unsub ───');
  assert('PHONE suppressed', await isSuppressed(PHONE), true);
  assert('MAIL  suppressed', await isSuppressed(MAIL), true);
  assert('EMAIL suppressed', await isSuppressed(EMAIL), true);
  line();

  await cleanup(lead.id);
  const left = await sql`SELECT COUNT(*)::int AS n FROM compliance_records WHERE target IN (${PHONE}, ${EMAIL}, ${MAIL})`;
  line(`─── CLEANUP: probe rows remaining = ${left[0].n} (expect 0) ───`);
  if (left[0].n !== 0) failures++;

  line();
  line('═══════════════════════════════════════════════════════════════');
  line(failures === 0 ? '  ✅ LIVE ROUTE: CROSS-CHANNEL FAN-OUT CONFIRMED' : `  ❌ ${failures} FAILURE(S)`);
  line('═══════════════════════════════════════════════════════════════');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
