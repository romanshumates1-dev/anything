/**
 * Campaign Launch API
 * POST /api/campaigns/launch
 * Orchestrates campaign launch sequence with preflight, warmup, and monitoring.
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import sql from '@/app/api/utils/sql';
import { sendAlert, ALERT_EVENTS } from '@/app/api/alerts/notification-engine';
import { HIGH_VOLUME_CONFIG, getWarmupTarget, isInWarmup } from '../config/high-volume';

interface LaunchRequest {
  campaignId: string;
  skipPreflight?: boolean;
  startDay?: number; // For resumed campaigns
}

interface LaunchResult {
  status: 'launched' | 'preflight_failed' | 'already_active' | 'error';
  campaignId: string;
  dailyTarget: number;
  warmupDay: number;
  inWarmup: boolean;
  nextCheckpoint: string;
  message: string;
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization' }, { status: 403 });
  }

  let body: LaunchRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { campaignId, skipPreflight = false, startDay = 1 } = body;

  if (!campaignId) {
    return Response.json({ error: 'campaignId required' }, { status: 400 });
  }

  try {
    // Get campaign
    const [campaign] = await sql`
      SELECT * FROM outreach_campaigns
      WHERE id = ${campaignId}
      AND organization_id = ${organization.id}
    `;

    if (!campaign) {
      return Response.json({ error: 'Campaign not found' }, { status: 404 });
    }

    // Check if already active
    if (campaign.status === 'ACTIVE') {
      return Response.json({
        status: 'already_active',
        campaignId,
        dailyTarget: getWarmupTarget(startDay),
        warmupDay: startDay,
        inWarmup: isInWarmup(startDay),
        nextCheckpoint: 'T+1hr: deliverability check',
        message: 'Campaign is already active',
      });
    }

    // Run preflight (unless skipped)
    if (!skipPreflight) {
      // In production, this would call the preflight endpoint
      // For now, do basic checks inline
      const [leadCount] = await sql`
        SELECT COUNT(*) as count FROM campaign_contacts
        WHERE campaign_id = ${campaignId}
        AND organization_id = ${organization.id}
        AND status = 'QUEUED'
      `;

      if (parseInt(leadCount?.count || '0') < 100) {
        return Response.json({
          status: 'preflight_failed',
          campaignId,
          dailyTarget: 0,
          warmupDay: 0,
          inWarmup: false,
          nextCheckpoint: 'N/A',
          message: `Insufficient leads: ${leadCount?.count || 0} queued (minimum 100)`,
        });
      }
    }

    // Calculate warmup day target
    const dailyTarget = getWarmupTarget(startDay);
    const inWarmup = isInWarmup(startDay);

    // Update campaign status to ACTIVE
    await sql`
      UPDATE outreach_campaigns
      SET
        status = 'ACTIVE',
        start_date = NOW(),
        daily_volume_max = ${dailyTarget},
        updated_at = NOW()
      WHERE id = ${campaignId}
      AND organization_id = ${organization.id}
    `;

    // Log launch
    console.log(
      `[CAMPAIGN-LAUNCH] Campaign ${campaignId} launched | Day ${startDay} | Target: ${dailyTarget.toLocaleString()} | Warmup: ${inWarmup}`
    );

    // Send admin notification
    await sendAlert({
      type: 'CAMPAIGN_LAUNCHED',
      severity: 'HIGH',
      title: 'Campaign Launched',
      message: `Campaign ${campaign.name} launched. Day ${startDay} target: ${dailyTarget.toLocaleString()} emails.`,
      context: {
        campaignId,
        campaignName: campaign.name,
        dailyTarget,
        warmupDay: startDay,
        inWarmup,
        awsCreditId: HIGH_VOLUME_CONFIG.awsCreditId,
      },
    });

    // Calculate next checkpoint
    let nextCheckpoint: string;
    if (startDay === 1) {
      nextCheckpoint = 'T+1hr: First deliverability check';
    } else if (inWarmup) {
      nextCheckpoint = `T+24hrs: Day ${startDay + 1} warmup (${getWarmupTarget(startDay + 1).toLocaleString()} target)`;
    } else {
      nextCheckpoint = 'T+24hrs: Daily report';
    }

    const result: LaunchResult = {
      status: 'launched',
      campaignId,
      dailyTarget,
      warmupDay: startDay,
      inWarmup,
      nextCheckpoint,
      message: `Campaign launched successfully. ${inWarmup ? `Warmup day ${startDay}/7.` : 'Full volume.'}`,
    };

    return Response.json(result);
  } catch (error: any) {
    console.error('[CAMPAIGN-LAUNCH] Error:', error);
    return Response.json(
      {
        status: 'error',
        campaignId,
        dailyTarget: 0,
        warmupDay: 0,
        inWarmup: false,
        nextCheckpoint: 'N/A',
        message: `Launch failed: ${error.message}`,
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/campaigns/launch?campaignId=xxx
 * Get launch status and warmup progress.
 */
export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization' }, { status: 403 });
  }

  const campaignId = req.nextUrl.searchParams.get('campaignId');
  if (!campaignId) {
    return Response.json({ error: 'campaignId required' }, { status: 400 });
  }

  try {
    const [campaign] = await sql`
      SELECT * FROM outreach_campaigns
      WHERE id = ${campaignId}
      AND organization_id = ${organization.id}
    `;

    if (!campaign) {
      return Response.json({ error: 'Campaign not found' }, { status: 404 });
    }

    // Calculate current warmup day based on start_date
    let warmupDay = 1;
    if (campaign.start_date) {
      const daysSinceStart = Math.floor(
        (Date.now() - new Date(campaign.start_date).getTime()) / (24 * 60 * 60 * 1000)
      );
      warmupDay = Math.max(1, daysSinceStart + 1);
    }

    // Get today's send count
    const [todayStats] = await sql`
      SELECT sent_count, target_count FROM campaign_daily_send_logs
      WHERE campaign_id = ${campaignId}
      AND date = CURRENT_DATE
    `;

    const dailyTarget = getWarmupTarget(warmupDay);
    const sentToday = parseInt(todayStats?.sent_count || '0');

    return Response.json({
      campaignId,
      name: campaign.name,
      status: campaign.status,
      warmupDay,
      inWarmup: isInWarmup(warmupDay),
      dailyTarget,
      sentToday,
      progress: dailyTarget > 0 ? Math.round((sentToday / dailyTarget) * 100) : 0,
      startDate: campaign.start_date,
      warmupSchedule: HIGH_VOLUME_CONFIG.warmupSchedule,
    });
  } catch (error: any) {
    console.error('[CAMPAIGN-LAUNCH] Error:', error);
    return Response.json({ error: 'Failed to get launch status' }, { status: 500 });
  }
}
