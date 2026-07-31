// @ts-check
/**
 * Seeds a dedicated test campaign for multi-channel outreach verification.
 *
 * This script creates:
 * 1. A new outreach campaign named "V3 Multi-Channel Verification".
 * 2. Three test leads and corresponding campaign contacts:
 *    - Contact 1: Has both phone and email.
 *    - Contact 2: Has only a phone number.
 *    - Contact 3: Has only an email address.
 *
 * This fixture is required to prove channel-independent logic for email (Phase 2),
 * manual calls (Phase 3), and their interplay with SMS.
 *
 * To run: node --env-file=.env apps/web/scripts/seed-multichannel-fixture.mjs
 */

import { neon } from '@neondatabase/serverless';
import { randomUUID } from 'node:crypto';

const contacts = [
  {
    firstName: 'Channel',
    lastName: 'Complete',
    phone: '+15550001111',
    email: 'channel.complete@example.com',
    address: '111 Full Circle',
  },
  {
    firstName: 'Channel',
    lastName: 'PhoneOnly',
    phone: '+15550002222',
    email: null,
    address: '222 Phone Lane',
  },
  {
    firstName: 'Channel',
    lastName: 'EmailOnly',
    phone: null,
    email: 'channel.emailonly@example.com',
    address: '333 Email Drive',
  },
];

async function main() {
  console.log('🌱 Seeding multi-channel verification fixture...');

  if (!process.env.DATABASE_URL) {
    console.error('❌ CRITICAL: DATABASE_URL environment variable is not set.');
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);

  const org = await sql`SELECT id FROM organizations WHERE slug = 'default' LIMIT 1`;
  if (!org.length) {
    console.error("❌ CRITICAL: Default organization 'org_default' not found.");
    process.exit(1);
  }
  const organizationId = org[0].id;

  const owner =
    await sql`SELECT id FROM "user" WHERE email = 'roman.shumate@dealswiftautomation.com' LIMIT 1`;
  if (!owner.length) {
    console.error('❌ CRITICAL: Owner user not found.');
    process.exit(1);
  }
  const ownerId = owner[0].id;

  const campaignName = 'V3 Multi-Channel Verification';
  const [campaign] = await sql`
    INSERT INTO outreach_campaigns (id, organization_id, owner_id, name, status)
    VALUES (${randomUUID()}, ${organizationId}, ${ownerId}, ${campaignName}, 'DRAFT')
    RETURNING id
  `;

  console.log(`📄 Created campaign "${campaignName}" with ID: ${campaign.id}`);

  for (const contact of contacts) {
    const [lead] = await sql`
      INSERT INTO leads (id, organization_id, owner_id, first_name, last_name, phone, email, address_line_1, source)
      VALUES (${randomUUID()}, ${organizationId}, ${ownerId}, ${contact.firstName}, ${contact.lastName}, ${contact.phone}, ${contact.email}, ${contact.address}, 'fixture')
      RETURNING id
    `;

    await sql`
      INSERT INTO campaign_contacts (id, organization_id, campaign_id, lead_id, status)
      VALUES (${randomUUID()}, ${organizationId}, ${campaign.id}, ${lead.id}, 'PENDING')
    `;

    console.log(
      `  - Added contact: ${contact.firstName} ${contact.lastName} (Phone: ${!!contact.phone}, Email: ${!!contact.email})`
    );
  }

  console.log(`\n✅ Success! Fixture created for campaign ID ${campaign.id}.`);
  console.log('   You can now use this campaign to test channel-specific outreach logic.');
}

main().catch((err) => {
  console.error('\n❌ Fixture creation failed:');
  console.error(err);
  process.exit(1);
});
