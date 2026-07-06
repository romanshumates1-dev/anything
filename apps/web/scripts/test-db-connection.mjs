import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function main() {
  try {
    const result = await sql`SELECT 1 AS ok`;
    console.log('Connected!', JSON.stringify(result));

    // List existing tables
    const tables = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `;
    console.log('Existing tables:', tables.map(t => t.table_name).join(', '));

    process.exit(0);
  } catch (e) {
    console.error('Failed:', e.message);
    process.exit(1);
  }
}

main();