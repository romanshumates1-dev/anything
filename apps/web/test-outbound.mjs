// Test outbound send via gateway
import { neon } from '@neondatabase/serverless';

async function main() {
  const sql = neon(process.env.DATABASE_URL);
  const testPhone = '+15025551234'; // Existing lead
  
  // Check if lead exists and AI conversation
  const lead = await sql`SELECT id FROM leads WHERE phone = ${testPhone}`;
  console.log('Lead:', lead[0]);
  
  if (lead.length > 0) {
    const leadId = lead[0].id;
    
    // Create an outbound message event directly via SQL to test the table
    // This simulates what would happen if Twilio sent successfully
    const result = await sql`
      INSERT INTO message_events (direction, lead_id, to_phone, body, provider, provider_message_id, status, metadata)
      VALUES ('outbound', ${leadId}, ${testPhone}, 'preflight test outbound message', 'twilio', 'SMtest${Date.now()}', 'sent', '{}')
      RETURNING id
    `;
    console.log('Created test outbound message event:', result);
    
    // Now run preflight check 8
    const events = await sql`
      SELECT id, direction, provider_message_id
      FROM message_events
      WHERE direction = 'outbound' AND created_at > NOW() - INTERVAL '5 minutes'
      ORDER BY created_at DESC
    `;
    console.log('Recent outbound events:', events);
  }
}

main().catch(console.error);