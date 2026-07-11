/**
 * Mock analytics seeder ($0 — DB rows only, no real SMS/AI). Populates
 * message_events (SMS + AI cost), marks some contacts replied/opted-out, and
 * inserts a couple of SIGNED contracts so the deeper analytics + margin render
 * with realistic non-zero numbers for org 'default'. Idempotent-ish: clears its
 * own prior seed rows (provider='seed') before inserting.
 */
import { neon } from '@neondatabase/serverless';
import { randomUUID } from 'node:crypto';

const sql = neon(process.env.DATABASE_URL);
const ORG = 'default';

const contacts = await sql`SELECT id, campaign_id, phone FROM campaign_contacts WHERE organization_id = ${ORG} ORDER BY created_at LIMIT 60`;
if (contacts.length === 0) { console.log('no contacts to seed against'); process.exit(0); }

// wipe prior seed
await sql`DELETE FROM message_events WHERE organization_id = ${ORG} AND provider = 'seed'`;

let outbound = 0, delivered = 0, inbound = 0, replies = 0, optouts = 0;
for (let i = 0; i < contacts.length; i++) {
  const c = contacts[i];
  // outbound send (all contacts) with realistic costs
  await sql`INSERT INTO message_events (id, organization_id, campaign_id, contact_id, direction, provider, status, segment_count, cost_cents, ai_cost_cents, created_at)
    VALUES (${randomUUID()}, ${ORG}, ${c.campaign_id}, ${c.id}, 'outbound', 'seed', ${'delivered'}, 1, 2, 0, NOW() - (${i} || ' hours')::interval)`;
  outbound++; delivered++;
  // ~45% reply with an AI-generated response pair
  if (i % 100 < 45) {
    await sql`INSERT INTO message_events (id, organization_id, campaign_id, contact_id, direction, provider, status, segment_count, cost_cents, ai_cost_cents, created_at)
      VALUES (${randomUUID()}, ${ORG}, ${c.campaign_id}, ${c.id}, 'inbound', 'seed', 'received', 1, 0, 0, NOW() - (${i} || ' hours')::interval)`;
    inbound++;
    await sql`INSERT INTO message_events (id, organization_id, campaign_id, contact_id, direction, provider, status, segment_count, cost_cents, ai_cost_cents, created_at)
      VALUES (${randomUUID()}, ${ORG}, ${c.campaign_id}, ${c.id}, 'outbound', 'seed', 'delivered', 1, 2, 3, NOW() - (${i} || ' hours')::interval)`;
    outbound++; delivered++;
    await sql`UPDATE campaign_contacts SET last_reply_at = NOW() - (${i} || ' hours')::interval, last_message_at = NOW() - (${i} || ' hours')::interval WHERE id = ${c.id}`;
    replies++;
  }
  // ~7% opt out
  if (i % 100 >= 45 && i % 100 < 52) {
    await sql`UPDATE campaign_contacts SET status = 'OPTED_OUT', opted_out_at = NOW() WHERE id = ${c.id} AND status::text = 'QUEUED'`;
    optouts++;
  }
}

// A couple of signed contracts → closed deals (for margin), if none seeded yet.
const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM contracts WHERE organization_id = ${ORG} AND status = 'SIGNED'`;
let contractsAdded = 0;
if (n < 2) {
  let [tpl] = await sql`SELECT id FROM contract_templates WHERE organization_id = ${ORG} AND direction = 'SELLER' LIMIT 1`;
  if (!tpl) {
    [tpl] = await sql`INSERT INTO contract_templates (id, organization_id, direction, template_body, is_active, created_at, updated_at)
      VALUES (${randomUUID()}, ${ORG}, 'SELLER', 'Seed assignment contract body.', true, NOW(), NOW()) RETURNING id`;
  }
  for (let k = 0; k < 2; k++) {
    await sql`INSERT INTO contracts (id, organization_id, template_id, direction, filled_body, status, signed_at, created_at, updated_at)
      VALUES (${randomUUID()}, ${ORG}, ${tpl.id}, 'SELLER', 'Seed signed assignment contract.', 'SIGNED', NOW(), NOW(), NOW())`;
    contractsAdded++;
  }
}

console.log(JSON.stringify({ contacts: contacts.length, outbound, delivered, inbound, replies, optouts, contractsAdded }));
