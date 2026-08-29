import { NextRequest, NextResponse } from 'next/server';
import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { getOrganization } from '@/lib/organization-context';
import { headers } from 'next/headers';
import { logEvent } from '@/app/api/utils/logger';

/**
 * POST /api/outreach/campaigns/[id]/complete
 *
 * Marks a campaign as COMPLETED. This archives the campaign and prevents
 * further messages from being sent. Completed campaigns remain visible
 * in analytics but are excluded from active campaign lists.
 */
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

    if (campaign.status === 'COMPLETED') {
      return NextResponse.json({ error: 'Campaign is already completed' }, { status: 400 });
    }

    // Cancel any pending jobs for this campaign
    await sql`
      UPDATE jobs SET status = 'cancelled', updated_at = now()
      WHERE payload->>'campaignId' = ${campaignId} AND status IN ('pending', 'processing')
    `;

    // Mark campaign as completed
    await sql`
      UPDATE outreach_campaigns
      SET status = 'COMPLETED', completed_at = now(), updated_at = now()
      WHERE id = ${campaignId}
    `;

    // Get final stats
    const [stats] = await sql`
      SELECT
        COUNT(*) as total_contacts,
        COUNT(*) FILTER (WHERE status = 'REPLIED') as replies,
        COUNT(*) FILTER (WHERE status = 'CONVERTED') as conversions
      FROM campaign_contacts
      WHERE campaign_id = ${campaignId}
    `;

    await logEvent('campaign_completed', 'campaign', campaignId, {
      previousStatus: campaign.status,
      totalContacts: stats?.total_contacts || 0,
      replies: stats?.replies || 0,
      conversions: stats?.conversions || 0,
    }, session.user.id);

    return NextResponse.json({
      id: campaignId,
      status: 'COMPLETED',
      completedAt: new Date().toISOString(),
      stats: {
        totalContacts: parseInt(stats?.total_contacts || '0'),
        replies: parseInt(stats?.replies || '0'),
        conversions: parseInt(stats?.conversions || '0'),
      },
    });
  } catch (error: any) {
    console.error('POST /api/outreach/campaigns/[id]/complete error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
