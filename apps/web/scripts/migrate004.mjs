import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
await sql`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS assignment_fee_cents integer`;
const [c] = await sql`SELECT count(*)::int n FROM information_schema.columns WHERE table_name='contracts' AND column_name='assignment_fee_cents'`;
console.log('assignment_fee_cents present:', c.n === 1);
// give the 2 seeded signed contracts a real fee so margin shows actual dollars
const r = await sql`UPDATE contracts SET assignment_fee_cents = 1200000 WHERE organization_id='default' AND status='SIGNED' AND assignment_fee_cents IS NULL RETURNING id`;
console.log('seeded fee on', r.length, 'signed contracts ($12,000 each)');
