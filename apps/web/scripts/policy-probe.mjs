// Read-only inspection of the effective signup-restriction policy, used by the
// release gate to explain why an E2E signup was accepted-but-unsessioned.
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i > 0) env[t.slice(0, i)] = t.slice(i + 1);
}
const sql = neon(env.DATABASE_URL);

const rows = await sql`
  SELECT key, value FROM app_settings
  WHERE key IN ('signup_restrictions','min_access_role','feature_flags')
  ORDER BY key
`;
for (const r of rows) console.log(r.key, '=', JSON.stringify(r.value));
if (rows.length === 0) console.log('(no app_settings rows at all)');

const orgTables = await sql`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name LIKE 'organization%'
  ORDER BY table_name
`;
console.log('LIVE organization* tables:', orgTables.map((r) => r.table_name).join(', '));

const cols = await sql`
  SELECT table_name, column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name IN (
      'organizations','organization','organization_members','organization_subscriptions',
      'subscription_plans','user_credits','ai_credit_ledger','credit_ledger',
      'contracts','action_queue','ai_conversations','leads'
    )
  ORDER BY table_name, ordinal_position
`;
const byTable = {};
for (const c of cols) (byTable[c.table_name] ||= []).push(c);
for (const [t, list] of Object.entries(byTable)) {
  console.log(`--- ${t} (${list.length} cols) ---`);
  for (const c of list) {
    const dflt = c.column_default ? ` default=${String(c.column_default).slice(0, 32)}` : '';
    console.log(`  ${c.column_name} ${c.data_type} ${c.is_nullable === 'NO' ? 'NOT NULL' : ''}${dflt}`);
  }
}
process.exit(0);
