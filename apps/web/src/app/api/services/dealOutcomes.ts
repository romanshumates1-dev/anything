import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';

export async function finalizeDeal(params: {
  organizationId: string;
  negotiationId: string;
  contactId: string;
  campaignId: string;
  direction: 'SELLER' | 'BUYER';
  agreedPrice: number;
  contactPhone: string;
}) {
  const { organizationId, negotiationId, contactId, campaignId, direction, agreedPrice, contactPhone } = params;

  // Update contact status
  await sql`
    UPDATE campaign_contacts
    SET status = 'DEAL_AGREED', updated_at = now()
    WHERE id = ${contactId}
  `;

  // Create human approval request
  await sql`
    INSERT INTO human_approvals (id, organization_id, type, negotiation_id, context, status)
    VALUES (${crypto.randomUUID()}, ${organizationId}, 'CONTRACT_SEND', ${negotiationId}, ${JSON.stringify({ agreedPrice, contactPhone, direction })}, 'PENDING')
  `;

  // Send deal-agreed message to contact
  // await sendSms({
  //   to: contactPhone,
  //   body: `Great news! We have a deal at $${agreedPrice.toLocaleString()}. We're preparing your contract now...`
  // });

  await logEvent('deal_agreed', 'negotiation', negotiationId, { agreedPrice, direction }, organizationId);
}

export async function markDealNoAgreement(params: {
  organizationId: string;
  negotiationId: string;
  contactId: string;
  contactPhone: string;
}) {
  const { organizationId, negotiationId, contactId, contactPhone } = params;

  await sql`
    UPDATE campaign_contacts SET status = 'DEAL_NO_AGREEMENT', updated_at = now() WHERE id = ${contactId}
  `;

  // Send professional no-deal message
  // await sendSms({
  //   to: contactPhone,
  //   body: `Thanks for the conversation! We weren't able to land on a number that works for both of us today...`
  // });

  await logEvent('deal_no_agreement', 'negotiation', negotiationId, {}, organizationId);
}