// Debug leads in DB
import { neon } from '@neondatabase/serverless';

async function main() {
  const sql = neon(process.env.DATABASE_URL);
  
  const leads = await sql`SELECT id, phone, status FROM leads LIMIT 5`;
  console.log('Leads:', leads);
  
  // Use first lead for preflight test
  if (leads.length > 0) {
    console.log('Can use lead:', leads[0].phone);
  }
}

main().catch(console.error);