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

    // Validate state transition
    if (campaign.status !== 'DRAFT' && campaign.status !== 'SCHEDULED') {
      return NextResponse.json({ error: `Cannot start campaign from status: ${campaign.status}` }, { status: 400 });
    }

    // Validate contacts exist
    const contactCount = await sql`
      SELECT COUNT(*)::int AS cnt FROM campaign_contacts WHERE campaign_id = ${campaignId}
    `;
    if ((contactCount[0]?.cnt ?? 0) === 0) {
      return NextResponse.json({ error: 'Cannot start campaign with zero contacts' }, { status: 400 });
    }

    const now = new Date();
    const startDate = campaign.start_date ? new Date(campaign.start_date) : now;
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + campaign.duration_days);

    const newStatus = startDate > now ? 'SCHEDULED' : 'ACTIVE';

    await sql`
      UPDATE outreach_campaigns
      SET status = ${newStatus}, start_date = COALESCE(start_date, ${now}), end_date = ${endDate}, updated_at = now()
      WHERE id = ${campaignId}
    `;

    await logEvent('campaign_started', 'campaign', campaignId, { status: newStatus, startDate, endDate }, session.user.id);

    return NextResponse.json({ id: campaignId, status: newStatus, startDate, endDate });
  } catch (error: any) {
    console.error('POST /api/outreach/campaigns/[id]/start error', error);
    return NextResponse.json({ error: 'Internal Server Error', detail: error.message }, { status: 500 });
  }
}