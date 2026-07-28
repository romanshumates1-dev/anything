import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { logEvent } from '@/app/api/utils/logger';
import { getOrganization } from '@/lib/organization-context';
import { recordStageTransition } from '@/app/api/services/stageTransitionRecorder';
import {
  sizeCampaign,
  checkInventory,
  type SellerFunnel,
  type BuyerFunnel,
} from '@/app/api/lead-finder/utils/planner';

/**
 * Phase 4 handoff — "Create campaign from segment".
 *
 * The tool ENDS where the existing pipeline BEGINS: this pushes a scored
 * segment of sourced_leads INTO the EXISTING contact set (`leads`) — the same
 * table the bulk importer writes — with type + owner name + property context in
 * metadata, and NO phone/email (the owner's EXISTING skip-trace step resolves
 * contact downstream, then DNC scrub, then the campaign wizard). It does NOT
 * duplicate import/skip-trace/DNC/scheduler — it only produces the leads they
 * consume, then marks each sourced lead handed_off.
 *
 * Body: { leadIds?: number[] }  OR  { filter?: {county,category,recordType,minScore} }
 */
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    // organization_id is NOT NULL on leads (migration 030) — this insert never
    // set it at all, so every handoff failed outright (same class as the
    // identical bug fixed in /api/leads/bulk — BREAKAGE_TABLE #35 follow-on).
    const organization = await getOrganization();
    if (!organization) {
      return Response.json({ error: 'No organization found' }, { status: 403 });
    }
    const orgId = organization.id;

    const b = (await request.json().catch(() => ({}))) as {
      leadIds?: unknown;
      filter?: { county?: string; category?: string; recordType?: string; minScore?: number };
      /** Deal-target mode: state the outcome, the system derives the volume. */
      targetDeals?: unknown;
      seller?: Partial<SellerFunnel>;
      buyer?: Partial<BuyerFunnel>;
    };

    const ids = Array.isArray(b.leadIds) ? b.leadIds.map(Number).filter(Number.isFinite) : [];
    const f = b.filter || {};
    const targetDeals = Number(b.targetDeals);
    const hasTarget = Number.isFinite(targetDeals) && targetDeals > 0;

    // Sizing is only computed in targetDeals mode, but it is returned to the
    // caller either way so the UI can show what the segment implies.
    let sizing: ReturnType<typeof sizeCampaign> | null = null;
    let shortfall: Record<string, ReturnType<typeof checkInventory>> | null = null;

    // Resolve the segment. Three modes, most explicit first:
    //   1. leadIds     — the operator picked exact rows
    //   2. targetDeals — "I want N assignments"; the system sizes and selects
    //   3. filter      — the original county/category/score sweep
    let segment: any[];

    if (ids.length) {
      segment = await sql`SELECT * FROM sourced_leads WHERE id = ANY(${ids}) AND status = 'new'`;
    } else if (hasTarget) {
      // ── DEAL-TARGET MODE. This is the path that removes the manual import
      // step: the operator states an outcome ("2 assignments") and the system
      // derives the volume and picks the highest-scoring inventory for BOTH
      // sides of the trade. A deal needs sellers to source it AND buyers to
      // assign it — selecting only sellers produces contracts nobody takes.
      sizing = sizeCampaign({ targetDeals, seller: b.seller, buyer: b.buyer });

      const minScore = Number(f.minScore) || 0;
      const county = f.county ?? null;

      // Two LIMITed selects rather than one, so a seller surplus can never
      // crowd out buyers (or vice versa) inside a single ORDER BY ... LIMIT.
      const [sellers, buyers] = await Promise.all([
        sql`
          SELECT * FROM sourced_leads
          WHERE status = 'new' AND category = 'seller'
            AND distress_score >= ${minScore}
            AND (${county}::text IS NULL OR county ILIKE ${county})
          ORDER BY distress_score DESC, id ASC
          LIMIT ${sizing.sellersNeeded}
        `,
        sql`
          SELECT * FROM sourced_leads
          WHERE status = 'new' AND category = 'buyer'
            AND distress_score >= ${minScore}
            AND (${county}::text IS NULL OR county ILIKE ${county})
          ORDER BY distress_score DESC, id ASC
          LIMIT ${sizing.buyersNeeded}
        `,
      ]);

      shortfall = {
        sellers: checkInventory(sizing.sellersNeeded, sellers.length),
        buyers: checkInventory(sizing.buyersNeeded, buyers.length),
      };

      // A short segment is handed off anyway — a partial campaign still
      // produces signal, and refusing would strand usable inventory. But the
      // response says so explicitly and unmissably: silently returning 1,200
      // of 10,334 leads while the operator believes the campaign is sized for
      // their target is the exact failure this mode exists to prevent.
      segment = [...sellers, ...buyers];
    } else {
      segment = await sql`
        SELECT * FROM sourced_leads
        WHERE status = 'new'
          AND distress_score >= ${Number(f.minScore) || 0}
          AND (${f.county ?? null}::text IS NULL OR county ILIKE ${f.county ?? null})
          AND (${f.category ?? null}::text IS NULL OR category = ${f.category ?? null})
          AND (${f.recordType ?? null}::text IS NULL OR record_type = ${f.recordType ?? null})
        ORDER BY distress_score DESC
      `;
    }

    if (segment.length === 0) {
      return Response.json(
        {
          error: 'Segment is empty (no un-handed-off leads match)',
          ...(sizing ? { required: { sellers: sizing.sellersNeeded, buyers: sizing.buyersNeeded } } : {}),
          hint: hasTarget
            ? 'Source inventory via /api/lead-finder/upload or a configured lead source before launching.'
            : undefined,
        },
        { status: 400 }
      );
    }

    let created = 0;
    for (const sl of segment) {
      // Claim the row FIRST (conditional on status='new') so a concurrent call
      // or retry can't double-hand-off the same lead. If we don't claim it,
      // someone else already did — skip.
      const claim = await sql`
        UPDATE sourced_leads SET status = 'handed_off', handed_off_at = now(), updated_at = now()
        WHERE id = ${sl.id} AND status = 'new'
        RETURNING id
      `;
      if (claim.length === 0) continue;

      const name = sl.owner_name || sl.property_address || `Parcel ${sl.parcel_id || sl.id}`;
      const metadata = {
        origin: 'lead-finder',
        sourced_lead_id: sl.id,
        property_address: sl.property_address,
        mailing_address: sl.mailing_address,
        parcel_id: sl.parcel_id,
        county: sl.county,
        record_type: sl.record_type,
        signals: sl.signals,
        distress_score: sl.distress_score,
        score_reasons: sl.score_reasons,
        provenance: sl.provenance,
        needs_skip_trace: true, // phone resolved by the existing skip-trace step
      };
      // Insert into the EXISTING leads table (importer's output shape). No
      // phone/email — skip-trace resolves contact downstream.
      const [lead] = await sql`
        INSERT INTO leads (type, name, email, phone, status, source, metadata, organization_id)
        VALUES (${sl.category}, ${name}, ${null}, ${null}, 'new', ${'lead-finder'}, ${JSON.stringify(metadata)}, ${orgId})
        RETURNING id
      `;
      await sql`
        UPDATE sourced_leads SET handed_off_lead_id = ${lead.id} WHERE id = ${sl.id}
      `;
      // Funnel analytics (P4): a handed-off lead-finder segment enters the
      // funnel at NEW, same as any other lead. Best-effort.
      await recordStageTransition({ leadId: lead.id, fromStage: null, toStage: 'NEW', channel: 'system' });
      created++;
    }

    await logEvent(
      'lead_finder_segment_handoff',
      'lead',
      'segment',
      {
        created,
        segmentSize: segment.length,
        mode: ids.length ? 'leadIds' : hasTarget ? 'targetDeals' : 'filter',
        ...(hasTarget ? { targetDeals, shortfall } : {}),
        filter: ids.length ? { leadIds: ids.length } : f,
      },
      admin.userId
    );

    // In deal-target mode the shortfall is surfaced as top-level warnings, not
    // buried in a nested object — an under-sized campaign that LOOKS successful
    // is the failure mode this whole mode exists to prevent.
    const warnings: string[] = [];
    if (sizing && shortfall) {
      if (!shortfall.sellers.feasible) {
        warnings.push(
          `UNDER-SIZED: got ${shortfall.sellers.available} of ${shortfall.sellers.requested} seller leads needed for ${targetDeals} assignment(s) — short ${shortfall.sellers.shortfall}. Expect proportionally fewer deals.`
        );
      }
      if (!shortfall.buyers.feasible) {
        warnings.push(
          `UNDER-SIZED: got ${shortfall.buyers.available} of ${shortfall.buyers.requested} buyer leads — short ${shortfall.buyers.shortfall}. A signed contract cannot be assigned without buyers.`
        );
      }
    }

    return Response.json({
      ...(sizing
        ? {
            targetDeals,
            required: { sellers: sizing.sellersNeeded, buyers: sizing.buyersNeeded },
            shortfall,
            fullySized: warnings.length === 0,
            warnings,
            model: {
              sellersPerDeal: sizing.sellersPerDeal,
              buyersPerDeal: sizing.buyersPerDeal,
            },
          }
        : {}),
      created,
      segmentSize: segment.length,
      next: 'Leads created with source=lead-finder (no contact yet). Run skip-trace to resolve phones, DNC scrub, then build a campaign in the wizard.',
      links: { contacts: '/leads', wizard: '/campaigns/wizard' },
    });
  } catch (error: any) {
    console.error('POST /api/lead-finder/create-campaign error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
