/**
 * Verify detailed schema of optimization tables
 */
import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

// Check indexes
const indexes = await sql`
  SELECT indexname, tablename
  FROM pg_indexes
  WHERE schemaname = 'public'
  AND tablename IN ('lead_scores', 'property_valuations', 'deal_probabilities', 'lead_actions', 'lead_events')
  ORDER BY tablename, indexname
`;

console.log('\nIndexes:');
for (const idx of indexes) {
  console.log(`  ${idx.tablename}: ${idx.indexname}`);
}

// Check constraints
const constraints = await sql`
  SELECT
    tc.table_name,
    tc.constraint_name,
    tc.constraint_type
  FROM information_schema.table_constraints tc
  WHERE tc.table_schema = 'public'
  AND tc.table_name IN ('lead_scores', 'property_valuations', 'deal_probabilities', 'lead_actions', 'lead_events')
  ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name
`;

console.log('\nConstraints:');
for (const c of constraints) {
  console.log(`  ${c.table_name}: ${c.constraint_type} - ${c.constraint_name}`);
}

console.log('\n✓ Schema verification complete');
process.exit(0);
