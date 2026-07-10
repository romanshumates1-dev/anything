// Verify Twilio webhook is configured correctly
import { neon } from '@neondatabase/serverless';

async function main() {
  const sql = neon(process.env.DATABASE_URL);
  const publicUrl = process.env.PUBLIC_WEBHOOK_URL;
  
  console.log('PUBLIC_WEBHOOK_URL:', publicUrl);
  console.log('\nExpected in Twilio Console: Messaging → "A MESSAGE COMES IN" → POST to this URL');
  
  // Check what test phone numbers are verified
  const testPhones = await sql`SELECT phone, verified, verified_at FROM test_phone_numbers WHERE verified = true`;
  console.log('\nVerified test phone numbers:');
  testPhones.forEach(p => console.log(`  ${p.phone} verified at ${p.verified_at}`));
  
  // Check leads we can target
  const leads = await sql`SELECT id, phone, name FROM leads LIMIT 5`;
  console.log('\nLeads in DB:');
  leads.forEach(l => console.log(`  id=${l.id} phone=${l.phone} name=${l.name}`));
}

main().catch(console.error);