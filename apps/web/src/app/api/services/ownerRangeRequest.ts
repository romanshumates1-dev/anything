import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';
import { scheduleRangeReminders, cancelRangeReminders, recordRangeLatency } from '@/app/api/utils/conversionLevers';

export async function requestOwnerRange(params: {
  organizationId: string;
  negotiationId: string;
  direction: 'SELLER' | 'BUYER';
  propertyContext: { address: string; notes?: string; sellerAskPrice?: number; buyerOfferPrice?: number };
  leadId?: number;
}) {
  const expiresAt = new Date(Date.now() + 24 * 3600_000);
  const requestId = crypto.randomUUID();

  await sql`
    INSERT INTO owner_range_requests (id, organization_id, negotiation_id, direction, property_context, status, expires_at)
    VALUES (${requestId}, ${params.organizationId}, ${params.negotiationId}, ${params.direction}, ${JSON.stringify(params.propertyContext)}, 'PENDING', ${expiresAt})
    ON CONFLICT (negotiation_id) DO NOTHING
  `;

  // Phase 6: schedule escalating reminders at 15min / 1hr / 3hr
  if (params.leadId) {
    await scheduleRangeReminders({
      requestId,
      organizationId: params.organizationId,
      leadId: params.leadId,
      propertyAddress: params.propertyContext.address,
    });
  }

  await logEvent('owner_range_requested', 'negotiation', params.negotiationId, { direction: params.direction, propertyContext: params.propertyContext }, params.organizationId);
}

export async function answerOwnerRange(opts: {
  requestId: string;
  organizationId: string;
  leadId: number;
  requestedAt: Date;
}): Promise<void> {
  await cancelRangeReminders(opts.requestId);
  await recordRangeLatency({
    requestId: opts.requestId,
    organizationId: opts.organizationId,
    leadId: opts.leadId,
    requestedAt: opts.requestedAt,
    answeredAt: new Date(),
  });
}

export function parsePriceRange(text: string): { min: number; max: number } | null {
  const match = text.match(/\$?([\d,]+)\s*(?:-|to|–)\s*\$?([\d,]+)/i);
  if (!match) return null;
  const min = parseInt(match[1].replace(/,/g, ''), 10);
  const max = parseInt(match[2].replace(/,/g, ''), 10);
  if (isNaN(min) || isNaN(max) || min <= 0 || max <= min) return null;
  return { min, max };
}