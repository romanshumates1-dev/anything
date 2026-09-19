/**
 * Campaign Automation Cron Endpoint
 *
 * Triggered by external scheduler (Vercel Cron, AWS EventBridge, etc.)
 * Runs all campaign automation jobs for active campaigns.
 *
 * Endpoints:
 * - GET /api/campaigns/automation/cron - Run all automation (hourly)
 * - GET /api/campaigns/automation/cron?type=outreach - Run outreach only (every 5 min)
 * - GET /api/campaigns/automation/cron?type=followups - Run followups only (daily)
 */
import { NextRequest, NextResponse } from 'next/server';
import { enqueueJob } from '@/app/api/utils/jobs';
import { isBetaFlagOn } from '@/app/api/utils/betaFlags';
import { logEvent } from '@/app/api/utils/logger';
import sql from '@/app/api/utils/sql';

// Secret for cron authentication (set in environment)
const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  const providedSecret = authHeader?.replace('Bearer ', '');

  if (CRON_SECRET && providedSecret !== CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check if campaign automation is enabled
  if (!(await isBetaFlagOn('campaignAutomation'))) {
    return NextResponse.json({
      status: 'skipped',
      reason: 'campaignAutomation flag is off',
    });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || 'all';

  try {
    // Get all active campaigns with automation enabled
    const campaigns = await sql`
      SELECT id, name, organization_id
      FROM outreach_campaigns
      WHERE status = 'ACTIVE' AND automation_enabled = true
    `;

    if (campaigns.length === 0) {
      return NextResponse.json({
        status: 'skipped',
        reason: 'No active campaigns with automation enabled',
      });
    }

    const results: Record<string, number> = {
      processLeadsJobs: 0,
      outreachJobs: 0,
      followupJobs: 0,
      statusUpdateJobs: 0,
    };

    for (const campaign of campaigns) {
      switch (type) {
        case 'all':
          // Queue all automation jobs for each campaign
          await enqueueJob('campaign_process_leads', {
            campaignId: campaign.id,
            organizationId: campaign.organization_id,
          }, { dedupeKey: `cron_process_leads:${campaign.id}:${getDateHour()}` });
          results.processLeadsJobs++;

          await enqueueJob('campaign_send_scheduled', {
            campaignId: campaign.id,
            organizationId: campaign.organization_id,
          }, { dedupeKey: `cron_outreach:${campaign.id}:${getDateTime5Min()}` });
          results.outreachJobs++;

          await enqueueJob('campaign_update_statuses', {
            campaignId: campaign.id,
            organizationId: campaign.organization_id,
          }, { dedupeKey: `cron_statuses:${campaign.id}:${getDateHour()}` });
          results.statusUpdateJobs++;
          break;

        case 'outreach':
          // Only queue outreach jobs (every 5 min)
          await enqueueJob('campaign_send_scheduled', {
            campaignId: campaign.id,
            organizationId: campaign.organization_id,
          }, { dedupeKey: `cron_outreach:${campaign.id}:${getDateTime5Min()}` });
          results.outreachJobs++;
          break;

        case 'followups':
          // Only queue followup jobs (daily)
          await enqueueJob('campaign_daily_followups', {
            campaignId: campaign.id,
            organizationId: campaign.organization_id,
          }, { dedupeKey: `cron_followups:${campaign.id}:${getDateDay()}` });
          results.followupJobs++;
          break;

        case 'leads':
          // Only queue lead processing jobs (hourly)
          await enqueueJob('campaign_process_leads', {
            campaignId: campaign.id,
            organizationId: campaign.organization_id,
          }, { dedupeKey: `cron_process_leads:${campaign.id}:${getDateHour()}` });
          results.processLeadsJobs++;
          break;

        default:
          return NextResponse.json({ error: `Unknown type: ${type}` }, { status: 400 });
      }
    }

    await logEvent('campaign_automation_cron', 'system', 'cron', {
      type,
      campaignsProcessed: campaigns.length,
      ...results,
    });

    return NextResponse.json({
      status: 'success',
      type,
      campaignsProcessed: campaigns.length,
      jobsQueued: results,
    });
  } catch (error: any) {
    console.error('Campaign automation cron error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// Helper functions for dedupe keys (ensure idempotency per time window)
function getDateHour(): string {
  const now = new Date();
  return `${now.toISOString().slice(0, 13)}`;
}

function getDateTime5Min(): string {
  const now = new Date();
  const min = Math.floor(now.getMinutes() / 5) * 5;
  return `${now.toISOString().slice(0, 14)}${String(min).padStart(2, '0')}`;
}

function getDateDay(): string {
  return new Date().toISOString().slice(0, 10);
}
