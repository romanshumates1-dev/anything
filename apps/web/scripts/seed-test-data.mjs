#!/usr/bin/env node
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

async function main() {
  // Check which tables exist
  const tables = await sql`SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY tablename`;
  console.log('Tables:', tables.map(t => t.tablename).join(', '));

  // Insert test campaign
  await sql`
    INSERT INTO outreach_campaigns (id, organization_id, direction, name, status, test_mode, daily_volume_min, daily_volume_max, duration_days, opening_message_id)
    VALUES ('camp_test_001', 'org_default', 'SELLER', 'Preflight Test', 'ACTIVE', true, 1, 10, 7, 'msg_opening_001')
    ON CONFLICT (id) DO UPDATE SET status='ACTIVE', test_mode=true
  `;
  console.log('✅ OUTREACH: camp_test_001 inserted');

  // Insert contact
  await sql`
    INSERT INTO campaign_contacts (id, campaign_id, organization_id, name, phone, status)
    VALUES ('contact_owner_001', 'camp_test_001', 'org_default', 'Owner', '+15025241638', 'QUEUED')
    ON CONFLICT (campaign_id, phone) DO NOTHING
  `;
  console.log('✅ CONTACT: +15025241638 inserted');

  // Insert test phone
  await sql`
    INSERT INTO test_phone_numbers (id, organization_id, phone, verified, verified_at)
    VALUES ('test_phone_001', 'org_default', '+15025241638', true, now())
    ON CONFLICT (organization_id, phone) DO UPDATE SET verified=true
  `;
  console.log('✅ TEST_PHONE: +15025241638 verified');

  // Verify
  const campaigns = await sql`SELECT id, name, status, test_mode FROM outreach_campaigns WHERE id = 'camp_test_001'`;
  console.log('Campaign:', JSON.stringify(campaigns[0]));

  const contacts = await sql`SELECT phone, status FROM campaign_contacts WHERE campaign_id = 'camp_test_001'`;
  console.log('Contact:', JSON.stringify(contacts[0]));

  const phones = await sql`SELECT phone, verified FROM test_phone_numbers WHERE phone = '+15025241638'`;
  console.log('TestPhone:', JSON.stringify(phones[0]));
}

main().catch(e => console.error('FATAL:', e.message));