// Create test lead for preflight
import { neon } from '@neondatabase/serverless';

async function main() {
  const sql = neon(process.env.DATABASE_URL);
  const testPhone = '+15551112222';
  
  await sql`
    INSERT INTO leads (phone, name, status)
    VALUES (${testPhone}, 'Preflight Test Lead', 'new')
  `;
  
  console.log(`Created lead for ${testPhone}`);
  
  const leads = await sql`SELECT id, phone FROM leads WHERE phone = ${testPhone}`;
  console.log('Lead:', leads[0]);
}

main().catch(console.error);