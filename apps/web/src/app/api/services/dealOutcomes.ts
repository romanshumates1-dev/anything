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
  const { organizationId, negotiationId, contactId, direction, agreedPrice, contactPhone } = params;

  await sql`
    UPDATE campaign_contacts
    SET status = 'DEAL_AGREED', updated_at = now()
    WHERE id = ${contactId}
  `;

  await sql`
    INSERT INTO human_approvals (id, organization_id, type, negotiation_id, context, status)
    VALUES (${crypto.randomUUID()}, ${organizationId}, 'CONTRACT_SEND', ${negotiationId}, ${JSON.stringify({ agreedPrice, contactPhone, direction })}, 'PENDING')
  `;

  await logEvent('deal_agreed', 'negotiation', negotiationId, { agreedPrice, direction }, organizationId);
}

export async function markDealNoAgreement(params: {
  organizationId: string;
  negotiationId: string;
  contactId: string;
  contactPhone: string;
}) {
  const { organizationId, negotiationId, contactId } = params;

  await sql`
    UPDATE campaign_contacts SET status = 'DEAL_NO_AGREEMENT', updated_at = now() WHERE id = ${contactId}
  `;

  await logEvent('deal_no_agreement', 'negotiation', negotiationId, {}, organizationId);
}