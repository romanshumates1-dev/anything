import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import {
  sizeCampaign,
  checkInventory,
  observedSellerFunnel,
  MIN_OBSERVED_DEALS,
  type SellerFunnel,
  type BuyerFunnel,
} from '@/app/api/lead-finder/utils/planner';

/**
 * POST /api/lead-finder/plan — "I want N deals; how many leads is that, and do
 * I actually have them?"
 *
 * This is the sizing step that turns a DEAL TARGET into a concrete seller +
 * buyer requirement, then reconciles it against real `sourced_leads`
 * inventory. It is the planning half of the campaign-launch flow; the existing
 * POST /api/lead-finder/create-campaign remains the execution half.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: invent leads. Nothing here can conjure
 * 6,000 seller records that were never sourced. When inventory is short it
 * says so, with the exact shortfall, rather than silently returning a smaller
 * segment and letting the operator believe the campaign is sized for the
 * target. A quietly-truncated list is the failure mode this endpoint exists to
 * prevent.
 *
 * Body:
 *   {
 *     targetDeals: number,            // required, > 0
 *     seller?: Partial<SellerFunnel>, // per-stage overrides
 *     buyer?: Partial<BuyerFunnel>,
 *     useObserved?: boolean,          // derive rates from real funnel data
 *     county?, category?, minScore?   // inventory filters
 *   }
 */
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const organization = await getOrganization();
    if (!organization) {
      return Response.json({ error: 'No organization found' }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      targetDeals?: unknown;
      seller?: Partial<SellerFunnel>;
      buyer?: Partial<BuyerFunnel>;
      useObserved?: boolean;
      county?: string;
      minScore?: number;
    };

    const targetDeals = Number(body.targetDeals);
    if (!Number.isFinite(targetDeals) || targetDeals <= 0) {
      return Response.json(
        { error: 'targetDeals must be a positive number' },
        { status: 400 }
      );
    }

    // ── Rate model: observed if there is enough real data, else planning
    // defaults. observedSellerFunnel refuses below MIN_OBSERVED_DEALS and
    // explains why, so an under-powered sample can never masquerade as a
    // measurement.
    let sellerOverrides = body.seller;
    let modelSource: 'default' | 'observed' | 'override' = body.seller ? 'override' : 'default';
    let modelNote: string | undefined;

    if (body.useObserved) {
      const [counts] = await sql`
        SELECT
          COUNT(*) FILTER (WHERE to_stage = 'CONTACTED')::int   AS contacted,
          COUNT(*) FILTER (WHERE to_stage = 'ENGAGED')::int     AS engaged,
          COUNT(*) FILTER (WHERE to_stage = 'NEGOTIATING')::int AS negotiating,
          COUNT(*) FILTER (WHERE to_stage = 'SIGNED')::int      AS signed,
          COUNT(*) FILTER (WHERE to_stage = 'ASSIGNED')::int    AS assigned
        FROM stage_transitions
      `;
      const c = counts as Record<string, number>;
      const observed = observedSellerFunnel({
        // stage_transitions does not record delivery receipts (those live in
        // message_events), so `delivered` is not separately observable here and
        // is passed equal to `sent`. That would imply 100% deliverability, so
        // the resulting funnel is only ever used when the guard below passes —
        // and today it never does, because SIGNED/ASSIGNED have no writers yet
        // (see FINAL_STATE.md: contractGeneration.ts has zero callers).
        sent: c.contacted ?? 0,
        delivered: c.contacted ?? 0,
        replied: c.engaged ?? 0,
        engaged: c.engaged ?? 0,
        offerDiscussed: c.negotiating ?? 0,
        underContract: c.signed ?? 0,
        closed: c.assigned ?? 0,
      });
      if (observed.usable) {
        sellerOverrides = observed.funnel;
        modelSource = 'observed';
      } else {
        modelNote = `observed rates unavailable — ${observed.reason}. Using planning defaults.`;
      }
    }

    const sizing = sizeCampaign({
      targetDeals,
      seller: sellerOverrides,
      buyer: body.buyer,
    });

    // ── Inventory. sourced_leads is intentionally contact-free (phones are
    // resolved downstream by skip-trace), so "available" counts SOURCEABLE
    // records, not reachable ones — the shortfall is a floor, not a ceiling.
    const minScore = Number(body.minScore) || 0;
    const county = body.county ?? null;

    const [inv] = await sql`
      SELECT
        COUNT(*) FILTER (WHERE category = 'seller')::int AS sellers,
        COUNT(*) FILTER (WHERE category = 'buyer')::int  AS buyers
      FROM sourced_leads
      WHERE status = 'new'
        AND distress_score >= ${minScore}
        AND (${county}::text IS NULL OR county ILIKE ${county})
    `;
    const availableSellers = (inv as { sellers: number })?.sellers ?? 0;
    const availableBuyers = (inv as { buyers: number })?.buyers ?? 0;

    const sellerInventory = checkInventory(sizing.sellersNeeded, availableSellers);
    const buyerInventory = checkInventory(sizing.buyersNeeded, availableBuyers);

    const warnings: string[] = [];
    if (modelNote) warnings.push(modelNote);
    if (!sellerInventory.feasible) {
      warnings.push(
        `Short ${sellerInventory.shortfall} seller leads for ${targetDeals} deal(s). Source more before launching, or lower the target.`
      );
    }
    if (!buyerInventory.feasible) {
      warnings.push(
        `Short ${buyerInventory.shortfall} buyer leads. Without a buyer list a signed contract cannot be assigned.`
      );
    }

    return Response.json({
      targetDeals,
      model: {
        source: modelSource,
        minObservedDealsRequired: MIN_OBSERVED_DEALS,
        sellersPerDeal: sizing.sellersPerDeal,
        buyersPerDeal: sizing.buyersPerDeal,
        sellerConversion: sizing.sellerConversion,
        buyerConversion: sizing.buyerConversion,
      },
      required: { sellers: sizing.sellersNeeded, buyers: sizing.buyersNeeded },
      inventory: { sellers: sellerInventory, buyers: buyerInventory },
      funnel: { seller: sizing.sellerStages, buyer: sizing.buyerStages },
      feasible: sellerInventory.feasible && buyerInventory.feasible,
      warnings,
      disclaimer:
        'Stage rates are PLANNING ASSUMPTIONS unless model.source is "observed". Volume estimates are not a forecast of results.',
    });
  } catch (error: any) {
    // A bad rate override is the caller's error, not a server fault — surface
    // the validation message instead of a blank 500.
    if (error instanceof Error && /must be a (finite rate|positive number)/.test(error.message)) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error('POST /api/lead-finder/plan error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
