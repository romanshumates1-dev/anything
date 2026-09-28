import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const sql = neon(env.DATABASE_URL);

const tables = [
  'leads', 'campaigns', 'campaign_leads', 'ai_conversations', 'contracts',
  'jobs', 'audit_logs', 'admin_audit_log', 'api_keys', 'app_settings',
  'inbound_messages', 'outreach_log', 'daily_activity', 'messages',
  'user', 'organizations', 'action_items', 'next_steps',
];

for (const t of tables) {
  const exists = await sql`SELECT 1 FROM information_schema.tables WHERE table_name = ${t} LIMIT 1`;
  if (!exists.length) {
    console.log(`\n### ${t}: *** TABLE DOES NOT EXIST ***`);
    continue;
  }
  const cols = await sql`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = ${t}
    ORDER BY ordinal_position`;
  console.log(`\n### ${t} (${cols.length} cols)`);
  console.log('  ' + cols.map((c) => c.column_name).join(', '));
}



const t = async (label, fn) => {
  try {
    const r = await fn();
    console.log(`  ${label}: OK ->`, JSON.stringify(r).slice(0, 80));
  } catch (e) {
    console.log(`  ${label}: FAIL -> ${String(e.message).split('\n')[0].slice(0, 110)}`);
  }
};

console.log('D) template_library enum domains (needed for input validation):');
{
  const inUse = await sql`SELECT DISTINCT category, channel FROM template_library`;
  console.log('  values in use:', JSON.stringify(inUse));
  const enums = await sql`
    SELECT t.typname, string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS labels
    FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname ILIKE '%categor%' OR t.typname ILIKE '%channel%'
    GROUP BY t.typname`;
  console.log('  enum types:', JSON.stringify(enums));
  const cols = await sql`
    SELECT column_name, udt_name FROM information_schema.columns
    WHERE table_name = 'template_library' AND column_name IN ('category','channel')`;
  console.log('  columns:', JSON.stringify(cols));
}

console.log('A) boolean-position fragment (regions/estimate, compliance/audit):');
await t('AND <fragment TRUE>      ', () => sql`SELECT 1 AS v WHERE true AND ${sql`TRUE`}`);
await t('OR <fragment FALSE>      ', () => sql`SELECT 1 AS v WHERE false OR ${sql`FALSE`}`);
await t('AND <frag> AND <frag>    ', () => sql`SELECT 1 AS v WHERE true AND ${sql`TRUE`} AND ${sql`TRUE`}`);
await t('nested w/ bound param    ', () => sql`SELECT 1 AS v WHERE true AND ${sql`AND 1 = ${1}`}`);

console.log('B) null interpolation (questionnaire, achievements) - is `SET col = $1` with a NULL param valid?');
const T = 'user_profiles';
const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = ${T} AND column_name = 'updated_at'`;
if (cols.length) {
  await t('SET updated_at = NULL (param)', () => sql`UPDATE ${sql(T)} SET updated_at = ${null} WHERE false RETURNING 1`);
  await t('SET updated_at = now() (frag) ', () => sql`UPDATE ${sql(T)} SET updated_at = ${sql`now()`} WHERE false RETURNING 1`);
} else {
  console.log(`  (no updated_at on ${T}; falling back)`);
  await t('SELECT NULL::timestamptz       ', () => sql`SELECT ${null}::timestamptz AS v`);
}

console.log('C) empty fragment:');
await t('AND <empty>              ', () => sql`SELECT 1 AS v WHERE true AND ${sql``}`);