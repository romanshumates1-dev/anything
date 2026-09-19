/**
 * Pipeline Cron API
 *
 * POST /api/pipeline/cron - Trigger pipeline run for all organizations
 *
 * This endpoint is designed to be called by a cron job (e.g., Vercel Cron).
 * It triggers pipeline runs for all active organizations.
 */

import { NextRequest, NextResponse } from 'next/server';
import sql from '@/app/api/utils/sql';
import { schedulePipelineRun, sendDailyDigests, processAutoContinue } from '@/app/api/utils/pipelineOrchestrator';

// Verify cron secret to prevent unauthorized access
function verifyCronSecret(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  // If no secret is configured, allow in development
  if (!cronSecret && process.env.NODE_ENV === 'development') {
    return true;
  }

  return authHeader === `Bearer ${cronSecret}`;
}

export async function POST(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action || 'run_all';

    if (action === 'run_all') {
      // Get all active organizations
      const organizations = await sql`
        SELECT DISTINCT organization_id
        FROM pipeline_config
        WHERE auto_lead_scoring = true
          OR auto_campaign_assignment = true
          OR auto_response_classification = true
      `;

      // If no orgs have pipeline config, get from campaigns
      if (organizations.length === 0) {
        const orgsByCampaign = await sql`
          SELECT DISTINCT organization_id
          FROM outreach_campaigns
          WHERE status = 'ACTIVE'
        `;
        organizations.push(...orgsByCampaign);
      }

      const scheduled: string[] = [];
      for (const org of organizations) {
        const jobId = await schedulePipelineRun(org.organization_id);
        if (jobId) {
          scheduled.push(org.organization_id);
        }
      }

      return NextResponse.json({
        success: true,
        action: 'run_all',
        organizationsScheduled: scheduled.length,
        organizations: scheduled,
      });
    }

    if (action === 'send_digests') {
      const sent = await sendDailyDigests();
      return NextResponse.json({
        success: true,
        action: 'send_digests',
        digestsSent: sent,
      });
    }

    if (action === 'process_auto_continue') {
      // Process auto-continue items for all orgs
      const orgs = await sql`
        SELECT DISTINCT organization_id
        FROM action_queue
        WHERE status = 'PENDING'
          AND auto_continue_at IS NOT NULL
          AND auto_continue_at <= NOW()
      `;

      let processed = 0;
      for (const org of orgs) {
        const count = await processAutoContinue(org.organization_id);
        processed += count;
      }

      return NextResponse.json({
        success: true,
        action: 'process_auto_continue',
        itemsProcessed: processed,
      });
    }

    return NextResponse.json(
      { error: 'Invalid action. Use: run_all, send_digests, or process_auto_continue' },
      { status: 400 }
    );
  } catch (error: unknown) {
    console.error('[pipeline/cron] POST error:', error);
    return NextResponse.json(
      { error: 'Failed to execute cron action' },
      { status: 500 }
    );
  }
}

// Vercel Cron configuration
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes for batch processing
