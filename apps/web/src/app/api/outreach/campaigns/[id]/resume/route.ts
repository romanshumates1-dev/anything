import { NextRequest, NextResponse } from 'next/server';
import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { logEvent } from '@/app/api/utils/logger';

export async function POST(
  request: NextRequest,
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
    const campaign = campaignRows[0];

    if (campaign.status !== 'PAUSED') {
      return NextResponse.json({ error: `Can only resume PAUSED campaigns (current: ${campaign.status})` }, { status: 400 });
    }

    const now = new Date();
    const endDate = new Date(campaign.start_date || now);
    endDate.setDate(endDate.getDate() + campaign.duration_days);

    const newStatus = now >= endDate ? 'COMPLETED' : 'ACTIVE';

    await sql`
      UPDATE outreach_campaigns SET status = ${newStatus}, updated_at = now() WHERE id = ${campaignId}
    `;

    await logEvent('campaign_resumed', 'campaign', campaignId, { status: newStatus }, session.user.id);

    return NextResponse.json({ id: campaignId, status: newStatus });
  } catch (error: any) {
    console.error('POST /api/outreach/campaigns/[id]/resume error', error);
    return NextResponse.json({ error: 'Internal Server Error', detail: error.message }, { status: 500 });
  }
}