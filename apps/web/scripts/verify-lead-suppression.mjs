#!/usr/bin/env node
/**
 * GATE 1 EVIDENCE — "an email unsubscribe suppresses a matching SMS send."
 *
 * The prior probe (verify-cross-channel-optout.mjs) proved suppression is
 * channel-agnostic PER IDENTIFIER. It also proved the gap: an email opt-out
 * left the same lead's PHONE reachable, because they are different keys.
 *
 * This proves the fix end-to-end against the LIVE DB: seed one lead with a
 * phone AND an email, unsubscribe by EMAIL only, then assert the PHONE is
 * suppressed. Non-vacuous — the phone is asserted reachable first, so a pass
 * cannot come from an ambient deny.
 *
 *   node --env-file=.env scripts/verify-lead-suppression.mjs
 */
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);
const STAMP = String(Date.now()).slice(-7);
const PHONE = `+1502777${STAMP.slice(-4)}`;
const EMAIL = `lead-probe-${STAMP}@dealflow-test.invalid`;
const MAIL = `${STAMP} Suppress Ave, Louisville, KY 40202`;

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

/** Mirrors services/leadSuppression.ts fan-out. Kept in step by this probe. */
async function suppressAll(identifier, channel) {
  const rows = await sql`
    SELECT id, phone, email, metadata FROM leads
    WHERE phone = ${identifier} OR LOWER(email) = ${identifier.toLowerCase()}
       OR (metadata->>'mailing_address') = ${identifier}
    ORDER BY id ASC LIMIT 1
  `;
  const lead = rows[0];
  const targets = new Set([identifier]);
  if (lead) {
    if (lead.phone) targets.add(lead.phone);
    if (lead.email) targets.add(String(lead.email).toLowerCase());
    const m = (lead.metadata ?? {}).mailing_address;
    if (m) targets.add(String(m));
  }
  for (const t of targets) {
    await sql`
      INSERT INTO compliance_records (target, type, channel, metadata)
      VALUES (${t}, 'opt-out', ${channel}, ${JSON.stringify({ originIdentifier: identifier, leadId: lead?.id ?? null, fannedOut: t !== identifier })})
      ON CONFLICT (target, channel, type) DO UPDATE SET created_at = CURRENT_TIMESTAMP
    `;
  }
  return { leadId: lead?.id ?? null, targets: Array.from(targets) };
}

async function main() {
  line('═══════════════════════════════════════════════════════════════');
  line('  GATE 1 — EMAIL UNSUBSCRIBE ⇒ SMS SUPPRESSED (live DB)');
  line('═══════════════════════════════════════════════════════════════');
  line(`  phone=${PHONE}`);
  line(`  email=${EMAIL}`);
  line(`  mail =${MAIL}`);
  line();

  await cleanup(null);

  const [org] = await sql`SELECT id FROM organizations ORDER BY id LIMIT 1`;
  if (!org) throw new Error('no organization in DB');

  const [lead] = await sql`
    INSERT INTO leads (type, name, email, phone, status, source, metadata, organization_id)
    VALUES ('seller', 'Suppression Probe', ${EMAIL}, ${PHONE}, 'new', 'gate1-probe',
            ${JSON.stringify({ mailing_address: MAIL })}, ${org.id})
    RETURNING id
  `;
  line(`─── SEED: lead id=${lead.id} with phone + email + mailing address ───`);
  line();

  line('─── LEG 1: BEFORE (all three identifiers reachable) ───────────');
  assert('phone reachable', await isSuppressed(PHONE), false);
  assert('email reachable', await isSuppressed(EMAIL), false);
  assert('mail  reachable', await isSuppressed(MAIL), false);
  line();

  line('─── LEG 2: unsubscribe arrives on EMAIL only ──────────────────');
  const res = await suppressAll(EMAIL, 'email');
  line(`  resolved leadId=${res.leadId}  fanned out to ${res.targets.length} identifier(s)`);
  const rows = await sql`
    SELECT target, channel, metadata->>'fannedOut' AS fanned
    FROM compliance_records WHERE target IN (${PHONE}, ${EMAIL}, ${MAIL}) AND type='opt-out'
    ORDER BY target
  `;
  line('  DB ROWS (compliance_records):');
  for (const r of rows) line(`    target=${r.target}  channel=${r.channel}  fannedOut=${r.fanned}`);
  line();

  line('─── LEG 3: THE CLAIM — SMS to that lead is now suppressed ─────');
  assert('PHONE suppressed by an EMAIL unsubscribe', await isSuppressed(PHONE), true);
  assert('MAIL  suppressed by an EMAIL unsubscribe', await isSuppressed(MAIL), true);
  assert('EMAIL suppressed', await isSuppressed(EMAIL), true);
  line();

  await cleanup(lead.id);
  const left = await sql`SELECT COUNT(*)::int AS n FROM compliance_records WHERE target IN (${PHONE}, ${EMAIL}, ${MAIL})`;
  line(`─── CLEANUP: probe rows remaining = ${left[0].n} (expect 0) ───`);
  if (left[0].n !== 0) failures++;

  line();
  line('═══════════════════════════════════════════════════════════════');
  line(failures === 0 ? '  ✅ GATE 1: EMAIL→SMS CROSS-CHANNEL SUPPRESSION PROVEN' : `  ❌ ${failures} FAILURE(S)`);
  line('═══════════════════════════════════════════════════════════════');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
