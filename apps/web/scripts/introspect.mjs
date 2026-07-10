import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
const t = async (name) => {
  const rows = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = ${name} ORDER BY ordinal_position`;
  console.log(`\n## ${name} (${rows.length} cols)`);
  console.log(rows.map((r) => r.column_name).join(', ') || '  (TABLE MISSING)');
};
for (const n of ['message_events', 'campaign_contacts', 'owner_range_requests', 'human_approvals', 'contracts', 'outreach_campaigns']) await t(n);
console.log('\n## message_events.status:', (await sql`SELECT status, count(*) FROM message_events GROUP BY status`).map((r) => `${r.status}:${r.count}`).join(', ') || '(none)');
console.log('## message_events.direction:', (await sql`SELECT direction, count(*) FROM message_events GROUP BY direction`).map((r) => `${r.direction}:${r.count}`).join(', ') || '(none)');
console.log('## campaign_contacts.status:', (await sql`SELECT status, count(*) FROM campaign_contacts GROUP BY status`).map((r) => `${r.status}:${r.count}`).join(', ') || '(none)');
console.log('## owner_range_requests.status:', (await sql`SELECT status, count(*) FROM owner_range_requests GROUP BY status`).map((r) => `${r.status}:${r.count}`).join(', ') || '(none)');
