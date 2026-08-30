/**
 * Phase P4 — Funnel analytics route.
 *
 * Returns stage transition counts and conversion rates derived from the
 * stage_transitions table. This provides audit-trail-based funnel metrics
 * that are consistent regardless of how the stages were recorded.
 *
 * Enhanced with:
 * - Visual funnel data structure with widths
 * - Drop-off analysis at each stage
 * - Biggest bottleneck identification
 * - Time-in-stage metrics
 */
import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { getOrganization } from '@/lib/organization-context';
import { headers } from 'next/headers';

interface FunnelStage {
  stage: string;
  count: number;
  dropOffCount: number;
  dropOffPercent: number;
  conversionToNext: number;
  cumulativeConversion: number;
  avgTimeInStage: number | null;
  widthPercent: number;
}

export async function GET(_request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization found' }, { status: 403 });
  }
  const org = organization.id;

  try {
    // Stage transition counts for the current organization.
    // stage_transitions has no contract_id column (it keys off lead_id +
    // campaign_id, both nullable/loosely-typed) — org scope comes from the
    // lead, not a nonexistent contract join (bug #36: this 500'd on every
    // call before).
    const stageCounts = await sql`
      SELECT st.to_stage, COUNT(*) as count
      FROM stage_transitions st
      JOIN leads l ON l.id = st.lead_id
      WHERE l.organization_id = ${org}
        AND st.to_stage IS NOT NULL
      GROUP BY st.to_stage
    `;

    // Build a funnel object with counts per stage
    const funnel: Record<string, number> = {
      NEW: 0,
      CONTACTED: 0,
      ENGAGED: 0,
      NEGOTIATING: 0,
      SIGNED: 0,
      ASSIGNED: 0,
    };

    for (const row of stageCounts) {
      funnel[row.to_stage] = Number(row.count);
    }

    // Also compute per-campaign stage counts. stage_transitions carries its
    // own campaign_id already — no join needed for this dimension, only for
    // the org-scope filter (via the lead).
    const perCampaign = await sql`
      SELECT
        st.campaign_id,
        st.to_stage,
        COUNT(*) as count
      FROM stage_transitions st
      JOIN leads l ON l.id = st.lead_id
      WHERE l.organization_id = ${org}
        AND st.to_stage IS NOT NULL
        AND st.campaign_id IS NOT NULL
      GROUP BY st.campaign_id, st.to_stage
      ORDER BY MAX(st.occurred_at) DESC
      LIMIT 50
    `;

    // Time series of transitions (last 14 days)
    const timeseries = await sql`
      SELECT
        to_char(d::date, 'YYYY-MM-DD') AS date,
        COALESCE((
          SELECT COUNT(*)
          FROM stage_transitions st
          JOIN leads l ON l.id = st.lead_id
          WHERE l.organization_id = ${org}
            AND st.occurred_at::date = d::date
        ), 0) AS transitions
      FROM generate_series(CURRENT_DATE - INTERVAL '13 days', CURRENT_DATE, INTERVAL '1 day') d
      ORDER BY d
    `;

    // Compute conversion rates
    const totalNew = funnel.NEW || 0;
    const totalNegotiating = funnel.NEGOTIATING || 0;
    const totalSigned = funnel.SIGNED || 0;
    const totalAssigned = funnel.ASSIGNED || 0;

    const conversions = {
      // Stage-to-stage conversion rates (percentage)
      contactedOfNew: totalNew > 0 ? Math.round((funnel.CONTACTED / totalNew) * 1000) / 10 : 0,
      engagedOfContacted: funnel.CONTACTED > 0 ? Math.round((funnel.ENGAGED / funnel.CONTACTED) * 1000) / 10 : 0,
      negotiatingOfEngaged: funnel.ENGAGED > 0 ? Math.round((totalNegotiating / funnel.ENGAGED) * 1000) / 10 : 0,
      signedOfNegotiating: totalNegotiating > 0 ? Math.round((totalSigned / totalNegotiating) * 1000) / 10 : 0,
      assignedOfSigned: totalSigned > 0 ? Math.round((totalAssigned / totalSigned) * 1000) / 10 : 0,
      // Overall funnel rate
      overall: totalNew > 0 ? Math.round((totalAssigned / totalNew) * 1000) / 10 : 0,
    };

    // Build visual funnel with drop-off analysis
    const stageOrder = ['NEW', 'CONTACTED', 'ENGAGED', 'NEGOTIATING', 'SIGNED', 'ASSIGNED'];
    const topOfFunnel = funnel.NEW || 1;

    const visualFunnel: FunnelStage[] = stageOrder.map((stage, index) => {
      const count = funnel[stage] || 0;
      const nextStage = stageOrder[index + 1];
      const nextCount = nextStage ? (funnel[nextStage] || 0) : count;
      const dropOffCount = index < stageOrder.length - 1 ? count - nextCount : 0;
      const dropOffPercent = count > 0 && index < stageOrder.length - 1
        ? Math.round((dropOffCount / count) * 1000) / 10
        : 0;
      const conversionToNext = count > 0 && index < stageOrder.length - 1
        ? Math.round((nextCount / count) * 1000) / 10
        : 100;
      const cumulativeConversion = topOfFunnel > 0
        ? Math.round((count / topOfFunnel) * 1000) / 10
        : 0;

      return {
        stage,
        count,
        dropOffCount,
        dropOffPercent,
        conversionToNext,
        cumulativeConversion,
        avgTimeInStage: null, // Would need timestamp data to calculate
        widthPercent: cumulativeConversion,
      };
    });

    // Find biggest bottleneck
    const bottleneckStages = visualFunnel.filter(s => s.dropOffPercent > 0);
    const biggestBottleneck = bottleneckStages.length > 0
      ? bottleneckStages.reduce((max, s) => s.dropOffPercent > max.dropOffPercent ? s : max)
      : null;

    const totalDropOff = topOfFunnel > 0
      ? Math.round((1 - (funnel.ASSIGNED || 0) / topOfFunnel) * 1000) / 10
      : 100;

    const funnelEfficiency = topOfFunnel > 0
      ? Math.round(((funnel.ASSIGNED || 0) / topOfFunnel) * 1000) / 10
      : 0;

    return Response.json({
      funnel,
      perCampaign,
      timeseries: timeseries.map((t: any) => ({
        date: t.date,
        transitions: Number(t.transitions),
      })),
      conversions,
      // NEW: Visual funnel with drop-off analysis
      visualFunnel: {
        stages: visualFunnel,
        totalDropOff,
        biggestBottleneck: biggestBottleneck
          ? { stage: biggestBottleneck.stage, dropOffPercent: biggestBottleneck.dropOffPercent }
          : null,
        efficiency: funnelEfficiency,
        topOfFunnel,
        bottomOfFunnel: funnel.ASSIGNED || 0,
      },
    });
  } catch (error: any) {
    console.error('GET /api/funnel error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}