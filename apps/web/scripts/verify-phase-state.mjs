/**
 * verify-phase-state.mjs — live DB probe for the Phase 0A-13 schema.
 * Prints counts for every new table + the fail-closed gate state.
 *   node --env-file=.env scripts/verify-phase-state.mjs
 */
import { neon } from '@neondatabase/serverless';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const sql = neon(process.env.DATABASE_URL);

const labels = [
  ['compliance_gates (total rows)', 'SELECT COUNT(*) c FROM compliance_gates'],
  ['compliance_gates (attorney_reviewed=true)', 'SELECT COUNT(*) c FROM compliance_gates WHERE attorney_reviewed = true'],
  ['outbound_kill_switch (active rows)', 'SELECT COUNT(*) c FROM outbound_kill_switch WHERE active = true'],
  ['lead_sources (Wave 2)', "SELECT COUNT(*) c FROM lead_sources WHERE notes LIKE '%Wave 2%'"],
  ['KY Jefferson sources', "SELECT COUNT(*) c FROM lead_sources WHERE name LIKE '%Jefferson%' AND jurisdiction LIKE 'KY-%'"],
  ['AL Jefferson sources', "SELECT COUNT(*) c FROM lead_sources WHERE name LIKE '%Jefferson%' AND jurisdiction LIKE 'AL-%'"],
  ['resurrection_campaign_config', 'SELECT COUNT(*) c FROM resurrection_campaign_config'],
  ['resurrection_sent_log', 'SELECT COUNT(*) c FROM resurrection_sent_log'],
  ['buyers', 'SELECT COUNT(*) c FROM buyers'],
  ['referral_partners', 'SELECT COUNT(*) c FROM referral_partners'],
  ['referral_handoffs', 'SELECT COUNT(*) c FROM referral_handoffs'],
  ['jv_deals', 'SELECT COUNT(*) c FROM jv_deals'],
  ['email_daily_sends', 'SELECT COUNT(*) c FROM email_daily_sends'],
  ['call_attempts', 'SELECT COUNT(*) c FROM call_attempts'],
  ['contracts with origination_type', 'SELECT COUNT(*) c FROM contracts WHERE origination_type IS NOT NULL'],
];

for (const [name, q] of labels) {
  try {
    const rows = await sql(q);
    console.log(name + ': ' + (rows[0]?.c ?? '?'));
  } catch (e) {
    console.log(name + ': ERROR - ' + e.message);
  }
}

// Fail-closed proof: show a few locked Wave-2 gates
const gates = await sql`SELECT DISTINCT jurisdiction, channel, attorney_reviewed FROM compliance_gates ORDER BY jurisdiction LIMIT 12`;
console.log('\nSample compliance gates (all must be attorney_reviewed=false):');
for (const g of gates) console.log('  ' + g.jurisdiction + ' x ' + g.channel + ' -> reviewed=' + g.attorney_reviewed);