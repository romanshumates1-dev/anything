/**
 * Dashboard Quick Stats API - GET key metrics with trends
 *
 * Returns the most important numbers with period-over-period
 * comparison for the quick stats bar.
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
    // SECURITY: All queries scoped to organization
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    // Current period stats
    const [
      [leadsCurrentPeriod],
      [leadsPreviousPeriod],
      [contactedCurrentPeriod],
      [contactedPreviousPeriod],
      [responsesCurrentPeriod],
      [responsesPreviousPeriod],
      [dealsCurrentPeriod],
      [dealsPreviousPeriod],
    ] = await sql.transaction([
      // Leads - current period
      sql`SELECT COUNT(*) FROM leads WHERE organization_id = ${org.id} AND created_at >= ${thirtyDaysAgo}`,
      // Leads - previous period
      sql`SELECT COUNT(*) FROM leads WHERE organization_id = ${org.id} AND created_at >= ${sixtyDaysAgo} AND created_at < ${thirtyDaysAgo}`,
      // Contacted - current period
      sql`SELECT COUNT(*) FROM leads WHERE organization_id = ${org.id} AND status IN ('contacted', 'responded', 'negotiating', 'under_contract', 'closed') AND updated_at >= ${thirtyDaysAgo}`,
      // Contacted - previous period
      sql`SELECT COUNT(*) FROM leads WHERE organization_id = ${org.id} AND status IN ('contacted', 'responded', 'negotiating', 'under_contract', 'closed') AND updated_at >= ${sixtyDaysAgo} AND updated_at < ${thirtyDaysAgo}`,
      // Responses - current period
      sql`SELECT COUNT(*) FROM ai_conversations WHERE lead_id IN (SELECT id FROM leads WHERE organization_id = ${org.id}) AND message_type = 'inbound' AND created_at >= ${thirtyDaysAgo}`,
      // Responses - previous period
      sql`SELECT COUNT(*) FROM ai_conversations WHERE lead_id IN (SELECT id FROM leads WHERE organization_id = ${org.id}) AND message_type = 'inbound' AND created_at >= ${sixtyDaysAgo} AND created_at < ${thirtyDaysAgo}`,
      // Deals - current period
      sql`SELECT COUNT(*) FROM leads WHERE organization_id = ${org.id} AND status = 'closed' AND updated_at >= ${thirtyDaysAgo}`,
      // Deals - previous period
      sql`SELECT COUNT(*) FROM leads WHERE organization_id = ${org.id} AND status = 'closed' AND updated_at >= ${sixtyDaysAgo} AND updated_at < ${thirtyDaysAgo}`,
    ]);

    // Calculate percentage changes
    const calcChange = (current: number, previous: number): number => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - previous) / previous) * 100);
    };

    const leadsCurrent = parseInt(leadsCurrentPeriod.count) || 0;
    const leadsPrevious = parseInt(leadsPreviousPeriod.count) || 0;
    const contactedCurrent = parseInt(contactedCurrentPeriod.count) || 0;
    const contactedPrevious = parseInt(contactedPreviousPeriod.count) || 0;
    const responsesCurrent = parseInt(responsesCurrentPeriod.count) || 0;
    const responsesPrevious = parseInt(responsesPreviousPeriod.count) || 0;
    const dealsCurrent = parseInt(dealsCurrentPeriod.count) || 0;
    const dealsPrevious = parseInt(dealsPreviousPeriod.count) || 0;

    return NextResponse.json({
      leads: {
        value: leadsCurrent,
        change: calcChange(leadsCurrent, leadsPrevious),
      },
      contacted: {
        value: contactedCurrent,
        change: calcChange(contactedCurrent, contactedPrevious),
      },
      responses: {
        value: responsesCurrent,
        change: calcChange(responsesCurrent, responsesPrevious),
      },
      deals: {
        value: dealsCurrent,
        change: calcChange(dealsCurrent, dealsPrevious),
      },
    });
  } catch (error: any) {
    console.error('GET /api/dashboard/quick-stats error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
