import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { getOrganization } from '@/lib/organization-context';
import { headers } from 'next/headers';

/**
 * Campaign funnel + cost + conversion analytics for the /analytics page
 * (session-authed, org-scoped). Extended 2026-07 with per-stage conversion
 * rates, response/opt-out rates, cost-per-deal, an estimated profit margin,
 * a per-campaign breakdown, and a 14-day time series.
 *
 * Money truth:
 *   - SMS + AI spend come from message_events.cost_cents / ai_cost_cents (REAL).
 *   - There is no assignment-fee/revenue column in the schema, so margin uses a
 *     clearly-labelled ESTIMATED fee per closed deal (env ASSIGNMENT_FEE_CENTS,
 *     default $10,000). Costs are real; the fee is an assumption, surfaced as such.
 *
 * campaign_contacts.status is the contact_status enum — always compare via
 * status::text so non-member literals don't throw.
 */
const ASSIGNMENT_FEE_CENTS = Number(process.env.ASSIGNMENT_FEE_CENTS || 1_000_000); // $10,000 default (estimate)

function rate(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : 0; // one-decimal percent
}

// Cents → "$1,234.56" for the human-readable margin note (mirrors the client
// formatter in src/app/analytics/page.tsx).
function money(cents: number): string {
  return `$${((cents || 0) / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export async function GET() {
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

    const [me] = await sql`
      SELECT
        COUNT(*) FILTER (WHERE direction = 'outbound') AS sent,
        COUNT(*) FILTER (WHERE direction = 'outbound' AND status IN ('delivered','dispatched','sent')) AS delivered,
        COUNT(*) FILTER (WHERE direction = 'inbound') AS inbound,
        COALESCE(SUM(cost_cents), 0) AS sms_cost_cents,
        COALESCE(SUM(ai_cost_cents), 0) AS ai_cost_cents
      FROM message_events
      WHERE organization_id = ${org}
    `;
    const [cc] = await sql`
      SELECT
        COUNT(*) AS total_contacts,
        COUNT(*) FILTER (WHERE last_reply_at IS NOT NULL) AS replied,
        COUNT(*) FILTER (WHERE opted_out_at IS NOT NULL) AS opted_out,
        COUNT(*) FILTER (WHERE status::text NOT IN ('QUEUED','OPTED_OUT','COLD','INVALID_NUMBER')) AS engaged,
        COUNT(*) FILTER (WHERE status::text = 'NEGOTIATING') AS negotiated,
        COUNT(*) FILTER (WHERE status::text IN ('DEAL_AGREED','CONTRACT_SENT','CONTRACT_SIGNED')) AS deals
      FROM campaign_contacts
      WHERE organization_id = ${org}
    `;
    const [ct] = await sql`
      SELECT
        COUNT(*) AS contracted,
        COUNT(*) FILTER (WHERE status::text IN ('SIGNED','CONTRACT_SIGNED','COMPLETED')) AS closed,
        COALESCE(SUM(assignment_fee_cents) FILTER (WHERE status::text IN ('SIGNED','CONTRACT_SIGNED','COMPLETED')), 0) AS actual_fee_cents,
        COUNT(*) FILTER (WHERE status::text IN ('SIGNED','CONTRACT_SIGNED','COMPLETED') AND assignment_fee_cents IS NOT NULL) AS closed_with_fee
      FROM contracts WHERE organization_id = ${org}
    `;

    // Per-campaign breakdown.
    const perCampaign = await sql`
      SELECT
        oc.id, oc.name, oc.status, oc.test_mode,
        COUNT(cc.id) AS contacts,
        COUNT(cc.id) FILTER (WHERE cc.last_reply_at IS NOT NULL) AS replied,
        COUNT(cc.id) FILTER (WHERE cc.status::text = 'NEGOTIATING') AS negotiating,
        COUNT(cc.id) FILTER (WHERE cc.status::text IN ('DEAL_AGREED','CONTRACT_SENT','CONTRACT_SIGNED')) AS deals,
        COALESCE((SELECT SUM(cost_cents + ai_cost_cents) FROM message_events me WHERE me.campaign_id = oc.id), 0) AS cost_cents
      FROM outreach_campaigns oc
      LEFT JOIN campaign_contacts cc ON cc.campaign_id = oc.id
      WHERE oc.organization_id = ${org}
      GROUP BY oc.id, oc.name, oc.status, oc.test_mode
      ORDER BY oc.created_at DESC
      LIMIT 50
    `;

    // 14-day time series of outbound sends + replies.
    const timeseries = await sql`
      SELECT
        to_char(d::date, 'YYYY-MM-DD') AS date,
        COALESCE((SELECT COUNT(*) FROM message_events me WHERE me.organization_id = ${org} AND me.direction='outbound' AND me.created_at::date = d::date), 0) AS sent,
        COALESCE((SELECT COUNT(*) FROM message_events me WHERE me.organization_id = ${org} AND me.direction='inbound' AND me.created_at::date = d::date), 0) AS replies
      FROM generate_series(CURRENT_DATE - INTERVAL '13 days', CURRENT_DATE, INTERVAL '1 day') d
      ORDER BY d
    `;

    const sent = Number(me.sent);
    const delivered = Number(me.delivered);
    const replied = Number(cc.replied);
    const engaged = Number(cc.engaged);
    const negotiated = Number(cc.negotiated);
    const contracted = Number(ct.contracted);
    const closed = Number(ct.closed);
    const optedOut = Number(cc.opted_out);
    const totalContacts = Number(cc.total_contacts);

    const smsCostCents = Number(me.sms_cost_cents);
    const aiCostCents = Number(me.ai_cost_cents);
    const totalCostCents = smsCostCents + aiCostCents;

    // Reach denominator: prefer real sends, else the contact base (so rates
    // are meaningful before any SMS has been dispatched).
    const reach = sent || totalContacts;

    // Revenue prefers ACTUAL recorded assignment fees; only deals with no fee
    // recorded fall back to the ASSIGNMENT_FEE_CENTS estimate.
    const closedWithFee = Number(ct.closed_with_fee);
    const actualRevenueCents = Number(ct.actual_fee_cents);
    const estimatedRevenueCents = Math.max(0, closed - closedWithFee) * ASSIGNMENT_FEE_CENTS;
    const revenueCents = actualRevenueCents + estimatedRevenueCents;
    const estimatedMarginCents = revenueCents - totalCostCents;
    const marginIsEstimated = estimatedRevenueCents > 0 || closed === 0;

    return Response.json({
      // ---- backward-compatible fields (existing page shape) ----
      funnel: { sent, delivered, replied, engaged, negotiated, contracted },
      smsCostCents,
      aiCostCents,
      scrubCostCents: 0,
      totalCostCents,

      // ---- deeper analytics ----
      totals: { contacts: totalContacts, closed, optedOut, inbound: Number(me.inbound) },
      conversion: {
        // stage-to-stage conversion, one-decimal percent
        deliveredOfSent: rate(delivered, sent),
        repliedOfReach: rate(replied, reach),
        engagedOfReplied: rate(engaged, replied || reach),
        negotiatedOfEngaged: rate(negotiated, engaged),
        contractedOfNegotiated: rate(contracted, negotiated),
        closedOfContracted: rate(closed, contracted),
        overall: rate(closed, reach), // reach → closed
      },
      rates: {
        responseRatePct: rate(replied, reach),
        optOutRatePct: rate(optedOut, reach),
        deliveryRatePct: rate(delivered, sent),
      },
      costs: {
        smsCostCents,
        aiCostCents,
        totalCostCents,
        costPerContactCents: reach > 0 ? Math.round(totalCostCents / reach) : 0,
        costPerDealCents: closed > 0 ? Math.round(totalCostCents / closed) : 0,
      },
      margin: {
        closedDeals: closed,
        closedWithRecordedFee: closedWithFee,
        actualRevenueCents,
        estimatedRevenueCents,
        revenueCents,
        estimatedFeePerDealCents: ASSIGNMENT_FEE_CENTS,
        estimatedMarginCents,
        isEstimated: marginIsEstimated,
        note: marginIsEstimated
          ? `Costs are real (SMS+AI). Revenue mixes recorded assignment fees (${money(actualRevenueCents)}) with an assumed ${money(ASSIGNMENT_FEE_CENTS)}/deal for ${Math.max(0, closed - closedWithFee)} closed deal(s) missing a fee — record fees on contracts to make this exact.`
          : 'Margin is based on ACTUAL recorded assignment fees and real SMS+AI costs.',
      },
      perCampaign: perCampaign.map((c: any) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        testMode: c.test_mode,
        contacts: Number(c.contacts),
        replied: Number(c.replied),
        negotiating: Number(c.negotiating),
        deals: Number(c.deals),
        costCents: Number(c.cost_cents),
      })),
      timeseries: timeseries.map((t: any) => ({ date: t.date, sent: Number(t.sent), replies: Number(t.replies) })),
    });
  } catch (error: any) {
    console.error('GET /api/analytics error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
