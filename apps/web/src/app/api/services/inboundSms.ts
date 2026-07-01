import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';
import { isOptOutMessage } from './optOutDetection';
import { checkConsent, registerOptOut } from '@/app/api/utils/compliance';

export async function processInboundSms(params: {
  from: string;
  to: string;
  body: string;
  organizationId: string;
}) {
  const { from, to, body, organizationId } = params;
  const trimmedBody = body.trim();

  // --- 1. OPT-OUT GATE (must run first, always) ---
  if (isOptOutMessage(trimmedBody)) {
    // Find any active campaign contact for this phone
    const contactRows = await sql`
      SELECT id FROM campaign_contacts
      WHERE organization_id = ${organizationId}
        AND phone = ${from}
        AND status NOT IN ('OPTED_OUT', 'COLD', 'DEAL_NO_AGREEMENT', 'CONTRACT_SIGNED')
      ORDER BY updated_at DESC
      LIMIT 1
    `;

    if (contactRows.length > 0) {
      await sql`
        UPDATE campaign_contacts
        SET status = 'OPTED_OUT', opted_out_at = now(), updated_at = now()
        WHERE id = ${contactRows[0].id}
      `;
    }

    // Register compliance opt-out
    await registerOptOut(from, 'sms', { organizationId, reason: 'stop_keyword' });

    // TODO: Send legally-required confirmation SMS via Twilio
    // await sendSms({ to: from, body: "You've been unsubscribed..." });

    return { action: 'opted_out', contactId: contactRows[0]?.id ?? null };
  }

  // --- 2. Check if sender is a known owner number ---
  const isOwner = await isKnownOwnerNumber(organizationId, from);

  if (isOwner) {
    return { action: 'owner_reply', body: trimmedBody };
  }

  // --- 3. Find active campaign contact for this phone ---
  const contactRows = await sql`
    SELECT cc.*, oc.direction, oc.id AS campaign_id
    FROM campaign_contacts cc
    JOIN outreach_campaigns oc ON oc.id = cc.campaign_id
    WHERE cc.organization_id = ${organizationId}
      AND cc.phone = ${from}
      AND cc.status NOT IN ('OPTED_OUT', 'COLD', 'DEAL_NO_AGREEMENT', 'CONTRACT_SIGNED', 'QUEUED')
    ORDER BY cc.updated_at DESC
    LIMIT 1
  `;

  if (contactRows.length === 0) {
    return { action: 'no_active_campaign' };
  }

  const contact = contactRows[0];

  // --- 4. Any reply halts follow-up scheduling ---
  await sql`
    UPDATE campaign_contacts
    SET last_reply_at = now(), updated_at = now()
    WHERE id = ${contact.id}
  `;

  return {
    action: 'contact_reply',
    contactId: contact.id,
    campaignId: contact.campaign_id,
    direction: contact.direction,
    body: trimmedBody,
  };
}

async function isKnownOwnerNumber(organizationId: string, phone: string): Promise<boolean> {
  // TODO: Replace with actual owner lookup when owner numbers are stored
  // For now, check if the number appears in leads table as a verified owner
  const rows = await sql`
    SELECT 1 FROM leads WHERE phone = ${phone} LIMIT 1
  `;
  return rows.length > 0;
}