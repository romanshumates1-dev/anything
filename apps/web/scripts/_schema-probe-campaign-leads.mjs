// One-off schema probe (2026-10-03): what statuses does campaign_leads actually
// use, and what columns exist? Read-only, prints shapes only.
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

const statuses = await sql`
  SELECT status, count(*)::int AS n
  FROM campaign_leads
  GROUP BY status
  ORDER BY n DESC
`;
console.log('campaign_leads.status:', JSON.stringify(statuses));

const cols = await sql`
  SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_name = 'campaign_leads'
  ORDER BY ordinal_position
`;
console.log('campaign_leads columns:', cols.map((c) => `${c.column_name}:${c.data_type}`).join(', '));

const convCols = await sql`
  SELECT column_name
  FROM information_schema.columns
  WHERE table_name = 'ai_conversations'
  ORDER BY ordinal_position
`;
console.log('ai_conversations columns:', convCols.map((c) => c.column_name).join(', '));
