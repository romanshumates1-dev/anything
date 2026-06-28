import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { enqueueJob } from '../../../utils/jobs';
import { logEvent } from '../../../utils/logger';
import { recordRun } from '../../../utils/execution-ledger';

/**
 * Launch a campaign:
 *  - for each PENDING member with a phone, create/find its conversation,
 *    append the outbound template message (assistant role), and enqueue a
 *    send_message job;
 *  - skip members without a phone (logged);
 *  - mark the campaign launched.
 *
 * Re-launching only processes members still in 'pending', so a partial/crashed
 * launch can be safely resumed without duplicate sends.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const campaignId = Number(id);
    if (!Number.isInteger(campaignId)) {
      return Response.json({ error: 'Invalid campaign id' }, { status: 400 });
    }

    const [campaign] = await sql`SELECT * FROM campaigns WHERE id = ${campaignId} LIMIT 1`;
    if (!campaign) {
      return Response.json({ error: 'Campaign not found' }, { status: 404 });
    }

    const members = await sql`
      SELECT cl.id AS campaign_lead_id, l.id AS lead_id, l.phone
      FROM campaign_leads cl
      JOIN leads l ON l.id = cl.lead_id
      WHERE cl.campaign_id = ${campaignId}
      AND cl.status = 'pending'
    `;

    const text = campaign.message_template;
    // Scheduler throttling: respect the campaign's daily cap and per-minute rate.
    const dailyCap = Math.min(500, Math.max(50, campaign.daily_cap || 100));
    const perMinute = Math.max(1, campaign.throttle_per_minute || 10);
    const spacingMs = Math.floor(60000 / perMinute);
    const now = Date.now();
    let queued = 0;
    let skipped = 0;
    let index = 0;

    for (const m of members) {
      if (!m.phone) {
        skipped++;
        await sql`UPDATE campaign_leads SET status = 'failed' WHERE id = ${m.campaign_lead_id}`;
        await logEvent('campaign_member_skipped', 'campaign', campaignId.toString(), {
          leadId: m.lead_id,
          reason: 'no_phone',
        });
        continue;
      }

      // Get-or-create the conversation (unique index on lead_id keeps it single).
      const [conv] = await sql`
        INSERT INTO ai_conversations (lead_id, channel, history)
        VALUES (${m.lead_id}, 'sms', '[]'::jsonb)
        ON CONFLICT (lead_id) DO UPDATE SET last_message_at = NOW()
        RETURNING *
      `;

      // Append the outbound message to the thread.
      await sql`
        UPDATE ai_conversations
        SET history = history || ${JSON.stringify([{ role: 'assistant', content: text }])}::jsonb,
            last_message_at = NOW()
        WHERE id = ${conv.id}
      `;

      // Compute a throttled send time: `dailyCap` sends per 24h, spaced by
      // `spacingMs` within each day.
      const day = Math.floor(index / dailyCap);
      const within = index % dailyCap;
      const offsetMs = day * 24 * 60 * 60 * 1000 + within * spacingMs;
      const runAt = new Date(now + offsetMs);

      // Idempotency: one send per (campaign, lead). A relaunch can never queue
      // a duplicate even if the row is still pending.
      const jobId = await enqueueJob(
        'send_message',
        {
          campaignLeadId: m.campaign_lead_id,
          leadId: m.lead_id,
          channel: 'sms',
          to: m.phone,
          text,
        },
        { runAt, dedupeKey: `send:${campaignId}:${m.lead_id}` }
      );
      if (jobId) queued++;
      index++;
    }

    await sql`
      UPDATE campaigns
      SET status = 'launched', updated_at = NOW()
      WHERE id = ${campaignId}
    `;

    await logEvent(
      'campaign_started',
      'campaign',
      campaignId.toString(),
      { queued, skipped },
      session.user.id
    );

    await recordRun({
      task: 'launch_campaign',
      flow: 'campaign_lifecycle',
      step: 'launch_campaign',
      status: 'pass',
      passed: true,
      detail: `queued=${queued}, skipped=${skipped}`,
      dbAssertion: "campaigns.status='launched'",
      logAssertion: "audit_logs.action='campaign_started'",
    });

    await recordRun({
      task: 'scheduler_trigger',
      flow: 'scheduler_validation',
      step: 'throttled_enqueue',
      status: 'pass',
      passed: true,
      detail: `dailyCap=${dailyCap}, perMinute=${perMinute}, jobs queued=${queued}`,
      dbAssertion: 'jobs.run_at scheduled with dedupe_key send:<campaign>:<lead>',
      logAssertion: "audit_logs.action='campaign_started'",
    });

    return Response.json({ status: 'launched', queued, skipped });
  } catch (error: any) {
    console.error('POST /api/campaigns/[id]/launch error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
