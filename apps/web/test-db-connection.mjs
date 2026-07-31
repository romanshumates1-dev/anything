import { neon } from '@neondatabase/serverless';

const url = "postgresql://postgres.apdngzmopuygwfchkttx:Dqbeasty+874774!!!@aws-0-us-east-1.pooler.supabase.com:6543/postgres";
const sql = neon(url);

try {
  const result = await sql`SELECT 1 as connected, current_database() as db`;
  console.log('✅ Connected:', result[0]);
  
  const tables = await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename LIMIT 10`;
  console.log('\nTables found:', tables.length);
  tables.forEach(t => console.log('  -', t.tablename));
} catch (error) {
  console.error('❌ Error:', error.message);
}
