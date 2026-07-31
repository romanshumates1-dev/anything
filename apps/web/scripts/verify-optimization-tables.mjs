/**
 * Verify that the 5 optimization tables were created successfully
 */
import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

const tables = await sql`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public'
  AND table_name IN ('lead_scores', 'property_valuations', 'deal_probabilities', 'lead_actions', 'lead_events')
  ORDER BY table_name
`;

console.log('Tables:', tables.map(r => r.table_name));

if (tables.length === 5) {
  console.log('✓ All 5 optimization tables exist');
  process.exit(0);
} else {
  console.error(`✗ Expected 5 tables, found ${tables.length}`);
  process.exit(1);
}
