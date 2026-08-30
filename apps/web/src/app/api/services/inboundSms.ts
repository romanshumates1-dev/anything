import sql from '@/app/api/utils/sql';
import { isOptOutMessage } from './optOutDetection';
import { registerOptOut } from '@/app/api/utils/compliance';
import { sendMessage } from '@/app/api/utils/messaging';

export async function processInboundSms(params: {
  from: string;
  to: string;
  body: string;
  organizationId: string;
}) {
  const { from, body, organizationId } = params;
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

    // [TCPA COMPLIANCE] Send legally-required opt-out confirmation SMS
    // TCPA requires confirmation within reasonable time
    try {
      await sendMessage({
        leadId: contactRows[0]?.id || 'opt-out',
        channel: 'sms',
        to: from,
        text: "You've been unsubscribed and will not receive further messages from us. Reply START to re-subscribe.",
        transactional: true, // Bypass dispatch gate for compliance message
      });
    } catch (e) {
      // Log but don't fail - opt-out was still registered
      console.error('[INBOUND-SMS] Failed to send opt-out confirmation:', e);
    }

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

/**
 * Check if a phone number belongs to a known operator/owner within the organization.
 *
 * Checks two sources:
 * 1. organization_members.phone - explicit staff phones
 * 2. users.phone where user belongs to org - member account phones
 *
 * This distinguishes operator replies from lead replies for proper routing.
 */
async function isKnownOwnerNumber(organizationId: string, phone: string): Promise<boolean> {
  // Normalize phone for comparison (strip non-digits, ensure E.164 format match)
  const normalizedPhone = phone.replace(/\D/g, '');
  const e164Phone = normalizedPhone.startsWith('1') ? `+${normalizedPhone}` : `+1${normalizedPhone}`;

  // Check organization_members table for staff phones
  const memberRows = await sql`
    SELECT 1 FROM organization_members
    WHERE organization_id = ${organizationId}
      AND (phone = ${phone} OR phone = ${e164Phone} OR phone = ${normalizedPhone})
    LIMIT 1
  `;
  if (memberRows.length > 0) return true;

  // Check users table for members of this organization
  const userRows = await sql`
    SELECT 1 FROM users u
    JOIN organization_members om ON om.user_id = u.id
    WHERE om.organization_id = ${organizationId}
      AND (u.phone = ${phone} OR u.phone = ${e164Phone} OR u.phone = ${normalizedPhone})
    LIMIT 1
  `;
  return userRows.length > 0;
}