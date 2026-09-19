import { NextRequest, NextResponse } from 'next/server';
import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { getOrganization } from '@/lib/organization-context';
import { headers } from 'next/headers';
import { logEvent } from '@/app/api/utils/logger';
import { validateTransition } from '@/app/api/utils/campaignStateMachine';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id: campaignId } = await params;
    const organization = await getOrganization();
    if (!organization) {
      return NextResponse.json({ error: 'No organization found' }, { status: 403 });
    }
    const organizationId = organization.id;

    const campaignRows = await sql`
      SELECT * FROM outreach_campaigns WHERE id = ${campaignId} AND organization_id = ${organizationId}
    `;
    if (campaignRows.length === 0) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }
    const campaign = campaignRows[0];

    // Determine target state based on campaign timing
    const now = new Date();
    const endDate = new Date(campaign.start_date || now);
    endDate.setDate(endDate.getDate() + campaign.duration_days);
    const targetStatus = now >= endDate ? 'COMPLETED' : 'ACTIVE';

    const transition = validateTransition(campaign.status, targetStatus);
    if (!transition.isValid) {
      return NextResponse.json({ error: transition.error }, { status: 400 });
    }

    await sql`
      UPDATE outreach_campaigns SET status = ${targetStatus}, updated_at = now() WHERE id = ${campaignId}
    `;

    await logEvent('campaign_resumed', 'campaign', campaignId, { status: targetStatus }, session.user.id);

    return NextResponse.json({ id: campaignId, status: targetStatus });
  } catch (error: any) {
    console.error('POST /api/outreach/campaigns/[id]/resume error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}