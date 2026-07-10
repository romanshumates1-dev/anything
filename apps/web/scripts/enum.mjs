import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
const r = await sql`SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='contact_status' ORDER BY e.enumsortorder`;
console.log('contact_status:', r.map(x=>x.enumlabel).join(', '));
