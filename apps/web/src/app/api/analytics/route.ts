import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';

/**
 * Campaign funnel + cost analytics for the /analytics page (session-authed,
 * org-scoped). The page shipped calling GET /api/analytics, which did not
 * exist → 404, so the page was stuck on its empty state forever.
 *
 * Funnel stages are computed from the pipeline that actually holds state:
 *   - sent/delivered  ← message_events (outbound SMS truth)
 *   - replied         ← campaign_contacts.last_reply_at
 *   - engaged         ← contacts that moved past the QUEUED stage
 *   - negotiated      ← contacts in NEGOTIATING
 *   - contracted      ← contracts rows
 * Costs are summed from message_events (cents). Returns a `funnel` object so
 * the page renders metrics instead of the "no data" card.
 */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const org = (session.user as any).organizationId || 'default';

    const [me] = await sql`
      SELECT
        COUNT(*) FILTER (WHERE direction = 'outbound') AS sent,
        COUNT(*) FILTER (WHERE direction = 'outbound' AND status IN ('delivered','dispatched','sent')) AS delivered,
        COALESCE(SUM(cost_cents), 0) AS sms_cost_cents,
        COALESCE(SUM(ai_cost_cents), 0) AS ai_cost_cents
      FROM message_events
      WHERE organization_id = ${org}
    `;
    const [cc] = await sql`
      SELECT
        COUNT(*) FILTER (WHERE last_reply_at IS NOT NULL) AS replied,
        COUNT(*) FILTER (WHERE status::text NOT IN ('QUEUED','OPTED_OUT','COLD','INVALID_NUMBER')) AS engaged,
        COUNT(*) FILTER (WHERE status::text = 'NEGOTIATING') AS negotiated
      FROM campaign_contacts
      WHERE organization_id = ${org}
    `;
    const [{ contracted }] = await sql`
      SELECT COUNT(*) AS contracted FROM contracts WHERE organization_id = ${org}
    `;

    const smsCostCents = Number(me.sms_cost_cents);
    const aiCostCents = Number(me.ai_cost_cents);

    return Response.json({
      funnel: {
        sent: Number(me.sent),
        delivered: Number(me.delivered),
        replied: Number(cc.replied),
        engaged: Number(cc.engaged),
        negotiated: Number(cc.negotiated),
        contracted: Number(contracted),
      },
      smsCostCents,
      aiCostCents,
      scrubCostCents: 0,
      totalCostCents: smsCostCents + aiCostCents,
    });
  } catch (error: any) {
    console.error('GET /api/analytics error', error);
    return Response.json({ error: 'Internal Server Error', detail: error.message }, { status: 500 });
  }
}
