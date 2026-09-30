/**
 * READ-ONLY schema introspection. Prints columns of the tables the broken
 * dashboard/analytics queries reference, plus which tables exist at all.
 * Never writes. Usage: node scripts/inspect-schema.mjs
 */
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i > 0) env[t.slice(0, i)] = t.slice(i + 1);
}
const { neon } = await import('@neondatabase/serverless');
const sql = neon(env.DATABASE_URL);

const wanted = [
  'leads', 'campaigns', 'ai_conversations', 'inbound_messages', 'outreach_log',
  'message_events', 'campaign_contacts', 'campaign_leads', 'audit_logs',
  'contracts', 'campaign_daily_send_logs', 'call_attempts',
];

const existing = await sql`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = ANY(${wanted})
`;
console.log('EXISTING:', existing.map(r => r.table_name).join(', '));
console.log('MISSING:', wanted.filter(w => !existing.some(r => r.table_name === w)).join(', '));

for (const t of ['leads', 'campaigns', 'message_events', 'campaign_contacts', 'audit_logs']) {
  const cols = await sql`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${t} ORDER BY ordinal_position
  `;
  console.log(`\n== ${t} (${cols.length} cols) ==`);
  console.log(cols.map(c => `${c.column_name}:${c.data_type}`).join(', '));
}

for (const t of ['contracts', 'campaign_lead_queue', 'buyer_assignments', 'inbound_messages', 'outreach_log']) {
  const cols = await sql`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${t} ORDER BY ordinal_position
  `;
  if (cols.length === 0) {
    console.log(`\n== ${t} == TABLE DOES NOT EXIST`);
  } else {
    console.log(`\n== ${t} (${cols.length} cols) ==`);
    console.log(cols.map(c => `${c.column_name}:${c.data_type}`).join(', '));
  }
}

// Value vocabularies the rewrites must match.
const me = await sql`SELECT direction, provider, status, COUNT(*)::int AS n FROM message_events GROUP BY 1,2,3 ORDER BY n DESC LIMIT 30`;
console.log('\n== message_events (direction, provider, status, n) ==');
console.log(me.map(r => `${r.direction}/${r.provider}/${r.status}=${r.n}`).join(', ') || '(empty)');

const cs = await sql`SELECT status, COUNT(*)::int AS n FROM campaigns GROUP BY 1 ORDER BY n DESC`;
console.log('\n== campaigns.status values ==');
console.log(cs.map(r => `${r.status}=${r.n}`).join(', ') || '(empty)');

const ls = await sql`SELECT status, COUNT(*)::int AS n FROM leads GROUP BY 1 ORDER BY n DESC`;
console.log('\n== leads.status values ==');
console.log(ls.map(r => `${r.status}=${r.n}`).join(', ') || '(empty)');

const qs = await sql`SELECT status, COUNT(*)::int AS n FROM campaign_lead_queue GROUP BY 1 ORDER BY n DESC`;
console.log('\n== campaign_lead_queue.status values ==');
console.log(qs.map(r => `${r.status}=${r.n}`).join(', ') || '(empty)');

// Row counts for every table the dashboard/analytics/webhook rewrites touch.
for (const t of ['campaigns', 'outreach_campaigns', 'campaign_contacts', 'campaign_lead_queue', 'message_events', 'contracts', 'contact_log', 'public_lead_pool', 'lead_outreach_log', 'compliance_records', 'buyer_assignments', 'buyers', 'sourced_leads', 'lead_sources']) {
  try {
    // t comes from this fixed list only; never from input.
    const r = await sql(`SELECT COUNT(*)::int AS n FROM "${t}"`);
    console.log(`count ${t} = ${r[0].n}`);
  } catch (e) {
    console.log(`count ${t} = ERROR: ${String(e.message || e).slice(0, 80)}`);
  }
}

// What do the campaign_id values in the populated queue actually look like?
const sample = await sql`SELECT campaign_id, COUNT(*)::int AS n FROM campaign_lead_queue GROUP BY 1 ORDER BY n DESC LIMIT 5`;
console.log('\ncampaign_lead_queue campaign_id samples:', JSON.stringify(sample));
