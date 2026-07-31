import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: "postgresql://postgres:Dqbeasty+874774!!!@db.apdngzmopuygwfchkttx.supabase.co:5432/postgres",
  ssl: { rejectUnauthorized: false }
});

try {
  const client = await pool.connect();
  console.log('✅ Connected to Supabase');
  
  const res = await client.query('SELECT current_database(), version()');
  console.log('Database:', res.rows[0]);
  
  const tables = await client.query(`
    SELECT tablename FROM pg_tables 
    WHERE schemaname = 'public' 
    ORDER BY tablename LIMIT 10
  `);
  console.log('\nTables found:', tables.rows.length);
  tables.rows.forEach(t => console.log('  -', t.tablename));
  
  client.release();
  await pool.end();
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
