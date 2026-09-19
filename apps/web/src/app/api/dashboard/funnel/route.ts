/**
 * Dashboard Funnel API - GET lead funnel statistics
 *
 * Returns aggregated lead counts at each stage of the
 * wholesaling pipeline for funnel visualization.
 */
import { NextResponse } from 'next/server';
import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { getOrganization } from '@/lib/organization-context';

export async function GET() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const org = await getOrganization();
  if (!org) {
    return NextResponse.json({ error: 'No organization' }, { status: 403 });
  }

  try {
    // Get lead counts by stage
    // SECURITY: All queries scoped to organization
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    // Current period (last 30 days)
    const [
      [totalLeads],
      [contacted],
      [responded],
      [negotiating],
      [underContract],
      [closed],
    ] = await sql.transaction([
      sql`SELECT COUNT(*) FROM leads WHERE organization_id = ${org.id} AND created_at >= ${thirtyDaysAgo}`,
      sql`SELECT COUNT(*) FROM leads WHERE organization_id = ${org.id} AND status IN ('contacted', 'responded', 'negotiating', 'under_contract', 'closed') AND created_at >= ${thirtyDaysAgo}`,
      sql`SELECT COUNT(*) FROM leads WHERE organization_id = ${org.id} AND status IN ('responded', 'negotiating', 'under_contract', 'closed') AND created_at >= ${thirtyDaysAgo}`,
      sql`SELECT COUNT(*) FROM leads WHERE organization_id = ${org.id} AND status IN ('negotiating', 'under_contract', 'closed') AND created_at >= ${thirtyDaysAgo}`,
      sql`SELECT COUNT(*) FROM leads WHERE organization_id = ${org.id} AND status IN ('under_contract', 'closed') AND created_at >= ${thirtyDaysAgo}`,
      sql`SELECT COUNT(*) FROM leads WHERE organization_id = ${org.id} AND status = 'closed' AND created_at >= ${thirtyDaysAgo}`,
    ]);

    // Previous period (30-60 days ago) for trend calculation
    const [
      [prevTotalLeads],
      [prevContacted],
      [prevResponded],
      [prevNegotiating],
      [prevUnderContract],
      [prevClosed],
    ] = await sql.transaction([
      sql`SELECT COUNT(*) FROM leads WHERE organization_id = ${org.id} AND created_at >= ${sixtyDaysAgo} AND created_at < ${thirtyDaysAgo}`,
      sql`SELECT COUNT(*) FROM leads WHERE organization_id = ${org.id} AND status IN ('contacted', 'responded', 'negotiating', 'under_contract', 'closed') AND created_at >= ${sixtyDaysAgo} AND created_at < ${thirtyDaysAgo}`,
      sql`SELECT COUNT(*) FROM leads WHERE organization_id = ${org.id} AND status IN ('responded', 'negotiating', 'under_contract', 'closed') AND created_at >= ${sixtyDaysAgo} AND created_at < ${thirtyDaysAgo}`,
      sql`SELECT COUNT(*) FROM leads WHERE organization_id = ${org.id} AND status IN ('negotiating', 'under_contract', 'closed') AND created_at >= ${sixtyDaysAgo} AND created_at < ${thirtyDaysAgo}`,
      sql`SELECT COUNT(*) FROM leads WHERE organization_id = ${org.id} AND status IN ('under_contract', 'closed') AND created_at >= ${sixtyDaysAgo} AND created_at < ${thirtyDaysAgo}`,
      sql`SELECT COUNT(*) FROM leads WHERE organization_id = ${org.id} AND status = 'closed' AND created_at >= ${sixtyDaysAgo} AND created_at < ${thirtyDaysAgo}`,
    ]);

    // Calculate trends (percentage change)
    const calculateTrend = (current: number, previous: number): number => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - previous) / previous) * 100);
    };

    const currentCounts = {
      leads: parseInt(totalLeads.count) || 0,
      contacted: parseInt(contacted.count) || 0,
      responded: parseInt(responded.count) || 0,
      negotiating: parseInt(negotiating.count) || 0,
      contract: parseInt(underContract.count) || 0,
      closed: parseInt(closed.count) || 0,
    };

    const prevCounts = {
      leads: parseInt(prevTotalLeads.count) || 0,
      contacted: parseInt(prevContacted.count) || 0,
      responded: parseInt(prevResponded.count) || 0,
      negotiating: parseInt(prevNegotiating.count) || 0,
      contract: parseInt(prevUnderContract.count) || 0,
      closed: parseInt(prevClosed.count) || 0,
    };

    // Get average deal value
    const [avgDealResult] = await sql`
      SELECT COALESCE(AVG(deal_value), 8500) as avg_value
      FROM leads
      WHERE organization_id = ${org.id}
        AND status = 'closed'
        AND deal_value > 0
    `;

    const avgDealValue = Math.round(parseFloat(avgDealResult?.avg_value || '8500'));
    const projectedRevenue = currentCounts.contract * avgDealValue;

    return NextResponse.json({
      stages: [
        { id: 'leads', count: currentCounts.leads, trend: calculateTrend(currentCounts.leads, prevCounts.leads) },
        { id: 'contacted', count: currentCounts.contacted, trend: calculateTrend(currentCounts.contacted, prevCounts.contacted) },
        { id: 'responded', count: currentCounts.responded, trend: calculateTrend(currentCounts.responded, prevCounts.responded) },
        { id: 'negotiating', count: currentCounts.negotiating, trend: calculateTrend(currentCounts.negotiating, prevCounts.negotiating) },
        { id: 'contract', count: currentCounts.contract, trend: calculateTrend(currentCounts.contract, prevCounts.contract) },
        { id: 'closed', count: currentCounts.closed, trend: calculateTrend(currentCounts.closed, prevCounts.closed) },
      ],
      avgDealValue,
      projectedRevenue,
      period: '30d',
    });
  } catch (error: any) {
    console.error('GET /api/dashboard/funnel error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
