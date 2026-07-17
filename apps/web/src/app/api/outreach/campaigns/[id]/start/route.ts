import { NextRequest, NextResponse } from 'next/server';
import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { logEvent } from '@/app/api/utils/logger';
import { recordComplianceAction } from '@/app/api/utils/compliance-audit';
import { dispatchOpenings } from '@/app/api/utils/cadenceEngine';

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

    // DNC-OFF COMPLIANCE AUDIT: Log the default DNC state at campaign launch
    await recordComplianceAction({
      organizationId,
      campaignId,
      userId: session.user.id,
      action: campaign.dnc_scrub_enabled ? 'DNC_SCRUB_ENABLED' : 'DNC_SCRUB_DISABLED',
      metadata: {
        confirmationText: campaign.dnc_scrub_enabled 
          ? 'DNC scrub is enabled by default for this campaign' 
          : 'DNC scrub has been disabled for this campaign',
        timestamp: now.toISOString(),
      },
    });

    await sql`
      UPDATE outreach_campaigns
      SET status = ${newStatus}, start_date = COALESCE(start_date, ${now}), end_date = ${endDate}, updated_at = now()
      WHERE id = ${campaignId}
    `;

    await logEvent('campaign_started', 'campaign', campaignId, { status: newStatus, startDate, endDate, dncScrubEnabled: campaign.dnc_scrub_enabled }, session.user.id);

    // INT-4: an ACTIVE campaign queues its OPENING sends (T+0), which start the
    // cadence ladder. Flag-gated inside dispatchOpenings — with cadenceEngine
    // OFF this returns {queued:0, reason:'flag_off'} and behaviour is exactly
    // the pre-INT-4 status flip.
    let cadence: { queued: number; reason?: string } = { queued: 0, reason: 'not_active' };
    if (newStatus === 'ACTIVE') {
      cadence = await dispatchOpenings(campaignId, organizationId);
    }

    return NextResponse.json({ id: campaignId, status: newStatus, startDate, endDate, cadence });
  } catch (error: any) {
    console.error('POST /api/outreach/campaigns/[id]/start error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}