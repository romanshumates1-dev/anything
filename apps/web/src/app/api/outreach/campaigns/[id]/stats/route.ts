import { NextRequest, NextResponse } from 'next/server';
import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const campaignId = params.id;
    const organizationId = (session.user as any).organizationId || 'default';

    const campaignRows = await sql`
      SELECT * FROM outreach_campaigns WHERE id = ${campaignId} AND organization_id = ${organizationId}
    `;
    if (campaignRows.length === 0) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    const byStatus = await sql`
      SELECT status, COUNT(*)::int AS cnt
      FROM campaign_contacts
      WHERE campaign_id = ${campaignId}
      GROUP BY status
    `;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sentTodayRow = await sql`
      SELECT sent_count::int FROM campaign_daily_send_logs
      WHERE campaign_id = ${campaignId} AND date = ${today}
    `;

    const history = await sql`
      SELECT date, sent_count::int AS sent
      FROM campaign_daily_send_logs
      WHERE campaign_id = ${campaignId}
      ORDER BY date ASC
      LIMIT 60
    `;

    const counts: Record<string, number> = {};
    for (const row of byStatus) counts[row.status] = row.cnt;

    const totalContacts = Object.values(counts).reduce((a, b) => a + b, 0);
    const sentTotal = counts['SENT'] || 0;
    const engaged = counts['ENGAGED'] || 0;
    const dealsAgreed = counts['DEAL_AGREED'] || 0;
    const dealsNoAgreement = counts['DEAL_NO_AGREEMENT'] || 0;
    const optedOut = counts['OPTED_OUT'] || 0;
    const cold = counts['COLD'] || 0;

    return NextResponse.json({
      totalContacts,
      byStatus: counts,
      sentToday: sentTodayRow[0]?.sent_count ?? 0,
      targetToday: campaignRows[0].daily_volume_max,
      dailyHistory: history,
      engagementRate: (sentTotal + engaged + cold) === 0 ? 0 : engaged / (sentTotal + engaged + cold),
      dealsClosed: dealsAgreed,
      dealsNoAgreement,
      optOutRate: sentTotal === 0 ? 0 : optedOut / sentTotal,
      daysRemaining: campaignRows[0].end_date ? Math.max(0, Math.ceil((new Date(campaignRows[0].end_date).getTime() - Date.now()) / 86400000)) : 0,
    });
  } catch (error: any) {
    console.error('GET /api/outreach/campaigns/[id]/stats error', error);
    return NextResponse.json({ error: 'Internal Server Error', detail: error.message }, { status: 500 });
  }
}