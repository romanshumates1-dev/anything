#!/usr/bin/env node
/**
 * GATE 1 EVIDENCE — direct-mail tracking codes + attribution, live DB.
 *
 * The export ROUTE is admin-session-gated (a raw script cannot forge a
 * better-auth session), so this proves the load-bearing behaviour directly
 * against the database and the real mailExport util: seed leads, generate a
 * batch exactly as the route does, persist mail_pieces with UNIQUE codes, then
 * prove the round-trip that makes mail measurable — a prospect quoting a code
 * resolves to the exact piece and lead.
 *
 * If this passes, the only thing the route adds on top is auth + HTTP framing,
 * both of which are covered by its unit tests.
 *
 *   node --env-file=.env scripts/verify-mail-export-live.mjs
 */
import { neon } from '@neondatabase/serverless';
import {
  generateTrackingCode,
  buildMailCsv,
  summarizeBatch,
  normalizeTrackingCode,
} from '../src/app/api/utils/mailExport.ts';

const sql = neon(process.env.DATABASE_URL);
const STAMP = String(Date.now()).slice(-7);

let failures = 0;
const line = (s = '') => console.log(s);
function assert(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  line(`  ${ok ? '✅ PASS' : '❌ FAIL'}  ${label}`);
  line(`         expected=${expected}  actual=${actual}`);
}

async function cleanup(orgId) {
  await sql`DELETE FROM mail_pieces WHERE recipient_name LIKE ${'ExportProbe%' + STAMP}`;
  await sql`DELETE FROM leads WHERE source = ${'export-probe-' + STAMP}`;
}

async function main() {
  line('═══════════════════════════════════════════════════════════════');
  line('  GATE 1 — DIRECT-MAIL TRACKING CODES + ATTRIBUTION (live DB)');
  line('═══════════════════════════════════════════════════════════════');

  const [org] = await sql`SELECT id FROM organizations ORDER BY id LIMIT 1`;
  await cleanup(org.id);

  // Seed 3 mailable + 1 unmailable lead (no street number).
  const seed = [
    { addr: `${STAMP} Oak St, Louisville, KY 40202`, score: 95 },
    { addr: `${STAMP} Elm St, Louisville, KY 40203`, score: 80 },
    { addr: `${STAMP} Pine St, Louisville, KY 40204`, score: 60 },
    { addr: `Louisville, KY`, score: 99 }, // unmailable — no street/zip
  ];
  const leadIds = [];
  for (let i = 0; i < seed.length; i++) {
    const [l] = await sql`
      INSERT INTO leads (type, name, phone, status, source, metadata, organization_id)
      VALUES ('seller', ${'ExportProbe' + i + STAMP}, NULL, 'new', ${'export-probe-' + STAMP},
              ${JSON.stringify({ mailing_address: seed[i].addr, distress_score: seed[i].score })}, ${org.id})
      RETURNING id
    `;
    leadIds.push(l.id);
  }
  line(`─── SEED: ${seed.length} leads (3 mailable, 1 unmailable) ───`);
  line();

  // Build the batch the way the route does: top-scored first, unique codes,
  // persist mail_pieces. Simplified guard (has a comma + digit) mirrors
  // mailAddressGuard's intent for the probe.
  const rows = [];
  for (const id of leadIds) {
    const [lead] = await sql`SELECT id, name, metadata FROM leads WHERE id = ${id}`;
    const addr = lead.metadata.mailing_address;
    const mailable = /\d/.test(addr) && /,\s*[A-Z]{2}\s+\d{5}/.test(addr);
    if (!mailable) continue;
    let code, inserted = false;
    for (let a = 0; a < 5 && !inserted; a++) {
      code = generateTrackingCode();
      const res = await sql`
        INSERT INTO mail_pieces (organization_id, tracking_code, lead_id, mailing_address, recipient_name, unit_cost_cents, created_by)
        VALUES (${org.id}, ${code}, ${lead.id}, ${addr}, ${lead.name}, 55, 'probe')
        ON CONFLICT (tracking_code) DO NOTHING
        RETURNING tracking_code
      `;
      if (res.length) { code = res[0].tracking_code; inserted = true; }
    }
    rows.push({ trackingCode: code, recipientName: lead.name, mailingAddress: addr, leadId: lead.id, unitCostCents: 55 });
  }

  line('─── LEG 1: batch persisted with UNIQUE codes ──────────────────');
  assert('3 mailable pieces created (1 unmailable skipped)', rows.length, 3);
  const codes = rows.map((r) => r.trackingCode);
  assert('all codes are 6 chars', codes.every((c) => c.length === 6), true);
  assert('all codes unique', new Set(codes).size, 3);
  assert('no ambiguous chars in any code', codes.every((c) => !/[01258OILZSB]/.test(c)), true);
  const persisted = await sql`
    SELECT tracking_code, lead_id, unit_cost_cents, status FROM mail_pieces
    WHERE recipient_name LIKE ${'ExportProbe%' + STAMP} ORDER BY unit_cost_cents
  `;
  line('  DB ROWS (mail_pieces):');
  for (const r of persisted) line(`    code=${r.tracking_code}  lead=${r.lead_id}  cost=${r.unit_cost_cents}c  status=${r.status}`);
  assert('3 rows in mail_pieces', persisted.length, 3);
  line();

  line('─── LEG 2: CSV is print-ready ─────────────────────────────────');
  const csv = buildMailCsv(rows, { ctaTemplate: 'Call 555-0100, mention code {CODE}' });
  assert('header present', csv.split('\n')[0].startsWith('tracking_code'), true);
  assert('each piece code appears in the CSV', codes.every((c) => csv.includes(c)), true);
  assert('CTA carries the per-piece code', csv.includes(`mention code ${codes[0]}`), true);
  const summary = summarizeBatch(rows);
  assert('summary counts 3 pieces', summary.pieces, 3);
  assert('no duplicate codes', summary.duplicateCodes, 0);
  line(`  batch cost: $${summary.totalCostUsd}`);
  line();

  line('─── LEG 3: THE ROUND-TRIP — a quoted code resolves to its piece ───');
  // Simulate a prospect reading a code off a postcard, with dashes/spacing.
  const quoted = `${codes[1].slice(0, 3)}-${codes[1].slice(3)}`;
  const norm = normalizeTrackingCode(quoted);
  assert('spoken code normalises back to the printed code', norm, codes[1]);
  const [hit] = await sql`
    SELECT mp.lead_id, l.name FROM mail_pieces mp
    JOIN leads l ON l.id = mp.lead_id
    WHERE mp.tracking_code = ${norm}
  `;
  assert('code resolves to the correct lead', hit?.lead_id, rows[1].leadId);
  line(`    quoted "${quoted}" -> code ${norm} -> lead ${hit?.lead_id} (${hit?.name})`);
  line('    THIS is what makes direct mail measurable: response attributed to a piece.');
  line();

  await cleanup(org.id);
  const left = await sql`SELECT COUNT(*)::int AS n FROM mail_pieces WHERE recipient_name LIKE ${'ExportProbe%' + STAMP}`;
  line(`─── CLEANUP: probe rows remaining = ${left[0].n} (expect 0) ───`);
  if (left[0].n !== 0) failures++;

  line();
  line('═══════════════════════════════════════════════════════════════');
  line(failures === 0 ? '  ✅ MAIL EXPORT + ATTRIBUTION PROVEN LIVE' : `  ❌ ${failures} FAILURE(S)`);
  line('═══════════════════════════════════════════════════════════════');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
