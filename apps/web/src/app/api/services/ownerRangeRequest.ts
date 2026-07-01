import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';

export async function requestOwnerRange(params: {
  organizationId: string;
  negotiationId: string;
  direction: 'SELLER' | 'BUYER';
  propertyContext: { address: string; notes?: string; sellerAskPrice?: number; buyerOfferPrice?: number };
}) {
  const expiresAt = new Date(Date.now() + 24 * 3600_000);

  await sql`
    INSERT INTO owner_range_requests (id, organization_id, negotiation_id, direction, property_context, status, expires_at)
    VALUES (${crypto.randomUUID()}, ${params.organizationId}, ${params.negotiationId}, ${params.direction}, ${JSON.stringify(params.propertyContext)}, 'PENDING', ${expiresAt})
    ON CONFLICT (negotiation_id) DO NOTHING
  `;

  // TODO: Send SMS to owner with min-max request
  // await sendSms({ to: ownerPhone, body: `...` });

  await logEvent('owner_range_requested', 'negotiation', params.negotiationId, { direction: params.direction, propertyContext: params.propertyContext }, params.organizationId);
}

export function parsePriceRange(text: string): { min: number; max: number } | null {
  const match = text.match(/\$?([\d,]+)\s*(?:-|to|–)\s*\$?([\d,]+)/i);
  if (!match) return null;
  const min = parseInt(match[1].replace(/,/g, ''), 10);
  const max = parseInt(match[2].replace(/,/g, ''), 10);
  if (isNaN(min) || isNaN(max) || min <= 0 || max <= min) return null;
  return { min, max };
}