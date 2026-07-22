import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { getOrganization } from '@/lib/organization-context';
import { headers } from 'next/headers';
import crypto from 'crypto';
import { buildPriceLadder } from '@/app/api/services/priceLadder';
import { enqueueJob } from '@/app/api/utils/jobs';
import { logEvent } from '@/app/api/utils/logger';

/**
 * Resolve an approval (session-authed, org-scoped). Money-moving route:
 *  - owner_range (from owner_range_requests): accept/custom writes the price
 *    ladder into negotiation_price_ranges, flips the negotiation out of
 *    AWAITING_OWNER_RANGE, and enqueues the next AI turn. reject expires it.
 *  - contract/other (human_approvals): accept resolves it, reject rejects it.
 *
 * Idempotent throughout: the resolving UPDATE is guarded by `status='PENDING'`
 * (a second call resolves zero rows and short-circuits), negotiation_price_ranges
 * has a UNIQUE(negotiation_id) with ON CONFLICT DO NOTHING, the status flip is
 * guarded by `status='AWAITING_OWNER_RANGE'`, and the AI-turn enqueue is
 * deduped by key. Org-scoped: an approval belonging to another org is invisible
 * (404) and cannot be acted on.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const organization = await getOrganization();
    if (!organization) {
      return Response.json({ error: 'No organization found' }, { status: 403 });
    }
    const org = organization.id;
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const action = body?.action;
    if (!['accept', 'reject', 'custom'].includes(action)) {
      return Response.json({ error: 'action must be accept | reject | custom' }, { status: 400 });
    }

    // --- owner_range approval path ---
    const [req] = await sql`
      SELECT id, negotiation_id, direction, property_context, status
      FROM owner_range_requests
      WHERE id = ${id} AND organization_id = ${org}
      LIMIT 1
    `;

    if (req) {
      if (action === 'reject') {
        const rejected = await sql`
          UPDATE owner_range_requests SET status = 'EXPIRED', answered_at = now()
          WHERE id = ${id} AND organization_id = ${org} AND status = 'PENDING'
          RETURNING id
        `;
        return Response.json({ ok: true, action: 'reject', status: 'EXPIRED', idempotent: rejected.length === 0 });
      }

      const max = Number(body?.range);
      if (!Number.isFinite(max) || max <= 0) {
        return Response.json({ error: 'range (max price) is required to accept' }, { status: 400 });
      }
      const min = Number(req.property_context?.ai_min) || Math.round(max * 0.85);

      // Idempotent resolve: only the first accept transitions PENDING -> ANSWERED.
      const resolved = await sql`
        UPDATE owner_range_requests SET status = 'ANSWERED', answered_at = now()
        WHERE id = ${id} AND organization_id = ${org} AND status = 'PENDING'
        RETURNING negotiation_id, direction
      `;
      if (resolved.length === 0) {
        return Response.json({ ok: true, status: 'ANSWERED', idempotent: true });
      }

      const negotiationId = req.negotiation_id;
      const direction = req.direction;
      const ladder = buildPriceLadder(min, max, direction);

      await sql`
        INSERT INTO negotiation_price_ranges
          (id, organization_id, negotiation_id, direction, min_price, max_price,
           tier1_price, tier2_price, tier3_price, tier4_price, current_tier, owner_responded_at)
        VALUES (${crypto.randomUUID()}, ${org}, ${negotiationId}, ${direction}, ${min}, ${max},
           ${ladder.tier1}, ${ladder.tier2}, ${ladder.tier3}, ${ladder.tier4}, 1, now())
        ON CONFLICT (negotiation_id) DO NOTHING
      `;

      // Unblock the negotiation. We model negotiation_id as the campaign_contacts id.
      await sql`
        UPDATE campaign_contacts SET status = 'NEGOTIATING', updated_at = now()
        WHERE id = ${negotiationId} AND organization_id = ${org} AND status = 'AWAITING_OWNER_RANGE'
      `;

      // Enqueue the next AI turn (idempotent via dedupeKey). Resolve a lead by
      // the contact's phone so the ai_reply handler has a conversation to act on.
      const [contact] = await sql`SELECT phone FROM campaign_contacts WHERE id = ${negotiationId} AND organization_id = ${org} LIMIT 1`;
      let leadId: number | null = null;
      if (contact?.phone) {
        const [lead] = await sql`SELECT id FROM leads WHERE phone = ${contact.phone} LIMIT 1`;
        leadId = lead?.id ?? null;
      }
      await enqueueJob('ai_reply', { leadId, negotiationId, organizationId: org }, { dedupeKey: `neg_turn_${negotiationId}` });

      await logEvent('owner_range_approved', 'negotiation', String(negotiationId), { min, max, direction }, session.user.id);

      return Response.json({ ok: true, status: 'ANSWERED', negotiationId, min, max });
    }

    // --- contract / generic human_approvals path ---
    const [ha] = await sql`SELECT id, status FROM human_approvals WHERE id = ${id} AND organization_id = ${org} LIMIT 1`;
    if (!ha) {
      return Response.json({ error: 'Approval not found' }, { status: 404 });
    }
    const newStatus = action === 'reject' ? 'REJECTED' : 'ANSWERED';
    const updated = await sql`
      UPDATE human_approvals SET status = ${newStatus}, resolved_at = now(), updated_at = now()
      WHERE id = ${id} AND organization_id = ${org} AND status = 'PENDING'
      RETURNING id
    `;
    return Response.json({ ok: true, status: newStatus, idempotent: updated.length === 0 });
  } catch (error: any) {
    console.error('POST /api/approvals/[id] error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
