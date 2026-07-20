/**
 * Phase P4 — Funnel analytics route.
 *
 * Returns stage transition counts and conversion rates derived from the
 * stage_transitions table. This provides audit-trail-based funnel metrics
 * that are consistent regardless of how the stages were recorded.
 */
import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const org = (session.user as any).organizationId || 'default';

  try {
    // Stage transition counts for the current organization
    // Join with contracts to get organization scope
    const stageCounts = await sql`
      SELECT to_stage, COUNT(*) as count
      FROM stage_transitions st
      JOIN contracts c ON c.id = st.contract_id
      WHERE c.organization_id = ${org}
        AND st.to_stage IS NOT NULL
      GROUP BY to_stage
      ORDER BY st.occurred_at ASC
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

    // Also compute per-campaign stage counts
    const perCampaign = await sql`
      SELECT
        c.id as contract_id,
        c.id as campaign_id,
        st.to_stage,
        COUNT(*) as count
      FROM stage_transitions st
      JOIN contracts c ON c.id = st.contract_id
      WHERE c.organization_id = ${org}
        AND st.to_stage IS NOT NULL
      GROUP BY c.id, st.to_stage
      ORDER BY c.created_at DESC
      LIMIT 50
    `;

    // Time series of transitions (last 14 days)
    const timeseries = await sql`
      SELECT
        to_char(d::date, 'YYYY-MM-DD') AS date,
        COALESCE((
          SELECT COUNT(*)
          FROM stage_transitions st
          JOIN contracts c ON c.id = st.contract_id
          WHERE c.organization_id = ${org}
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

    return Response.json({
      funnel,
      perCampaign,
      timeseries: timeseries.map((t: any) => ({
        date: t.date,
        transitions: Number(t.transitions),
      })),
      conversions,
    });
  } catch (error: any) {
    console.error('GET /api/funnel error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}