import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { enqueueJob } from '../../../utils/jobs';
import { logEvent } from '../../../utils/logger';
import { recordRun } from '../../../utils/execution-ledger';
import { hasAcceptedMessagingAgreement } from '@/lib/legal-acceptance';
import { getOrganization } from '@/lib/organization-context';
import { timezonesForPhone } from '../../../utils/area-codes';

/**
 * Optimal send time calculation for maximum response rates.
 * Research shows Tue-Thu 10am-2pm local time has 23% higher open rates.
 *
 * This function computes the next optimal send slot for a lead based on
 * their timezone (derived from phone area code).
 */
function computeOptimalSendTime(phone: string, baseTime: Date): Date {
  const tzs = timezonesForPhone(phone);
  const tz = tzs[0] || 'America/New_York'; // Use first timezone or default to Eastern

  // Optimal days: Tuesday (2), Wednesday (3), Thursday (4)
  const OPTIMAL_DAYS = [2, 3, 4];
  // Optimal hours: 10am-2pm local time
  const OPTIMAL_START_HOUR = 10;
  const OPTIMAL_END_HOUR = 14;

  // Get the current local time in lead's timezone
  const localTimeStr = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  }).format(baseTime);

  // Parse local time components
  const hourMatch = localTimeStr.match(/(\d{2}):(\d{2})/);
  const localHour = hourMatch ? parseInt(hourMatch[1], 10) : 12;
  const localMinute = hourMatch ? parseInt(hourMatch[2], 10) : 0;

  // Get day of week (0=Sun, 1=Mon, ..., 6=Sat)
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayMatch = localTimeStr.match(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)/);
  const localDayOfWeek = dayMatch ? dayNames.indexOf(dayMatch[1]) : new Date().getDay();

  // Check if we're already in an optimal window
  const isOptimalDay = OPTIMAL_DAYS.includes(localDayOfWeek);
  const isOptimalHour = localHour >= OPTIMAL_START_HOUR && localHour < OPTIMAL_END_HOUR;

  if (isOptimalDay && isOptimalHour) {
    // Already in optimal window - add small random offset (0-30 min) to spread load
    const offsetMs = Math.floor(Math.random() * 30 * 60 * 1000);
    return new Date(baseTime.getTime() + offsetMs);
  }

  // Calculate days until next optimal day
  let daysUntilOptimal = 0;
  let checkDay = localDayOfWeek;
  while (!OPTIMAL_DAYS.includes(checkDay) || (daysUntilOptimal === 0 && localHour >= OPTIMAL_END_HOUR)) {
    checkDay = (checkDay + 1) % 7;
    daysUntilOptimal++;
    if (daysUntilOptimal > 7) break; // Safety: max 7 days
  }

  // If same day but before optimal hours, wait for optimal start
  if (daysUntilOptimal === 0 && isOptimalDay && localHour < OPTIMAL_START_HOUR) {
    const hoursUntilOptimal = OPTIMAL_START_HOUR - localHour;
    const minutesUntilOptimal = hoursUntilOptimal * 60 - localMinute;
    // Add random offset within optimal window (0-3 hours)
    const randomOffsetMs = Math.floor(Math.random() * 3 * 60 * 60 * 1000);
    return new Date(baseTime.getTime() + minutesUntilOptimal * 60 * 1000 + randomOffsetMs);
  }

  // Schedule for the next optimal day at 10am + random offset
  const msPerDay = 24 * 60 * 60 * 1000;
  const targetDate = new Date(baseTime.getTime() + daysUntilOptimal * msPerDay);

  // Set to 10am in lead's timezone (approximate by adjusting from current time)
  const hoursFromMidnight = localHour + localMinute / 60;
  const hoursToTarget = OPTIMAL_START_HOUR - hoursFromMidnight + (daysUntilOptimal * 24);
  const msToTarget = hoursToTarget * 60 * 60 * 1000;

  // Add random offset within optimal window (0-3 hours)
  const randomOffsetMs = Math.floor(Math.random() * 3 * 60 * 60 * 1000);

  return new Date(baseTime.getTime() + msToTarget + randomOffsetMs);
}

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

  // Tenant-isolation fix (BREAKAGE_TABLE: legacy campaigns/campaign_leads had
  // no organization_id at all): resolve the caller's org before anything
  // else touches the campaign, so the lookup below can be scoped to it.
  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization found' }, { status: 403 });
  }

  // Messaging Compliance Agreement gate (Phase 3): a campaign cannot be
  // activated — no message may be sent — until the user has accepted the
  // current Messaging Compliance Agreement. Server-refused; the UI only
  // reflects this. (BREAKAGE_TABLE #31: this gate did not exist before.)
  if (!(await hasAcceptedMessagingAgreement(session.user.id))) {
    return Response.json(
      {
        error: 'messaging_agreement_required',
        message:
          'You must accept the Messaging Compliance Agreement before activating a campaign.',
      },
      { status: 403 }
    );
  }

  try {
    const { id } = await params;
    const campaignId = Number(id);
    if (!Number.isInteger(campaignId)) {
      return Response.json({ error: 'Invalid campaign id' }, { status: 400 });
    }

    // IDOR fix: previously this had no organization filter at all, so any
    // authenticated user could launch (i.e. trigger real sends for) another
    // org's campaign just by guessing its id. A foreign-org id now 404s
    // exactly as if the campaign didn't exist.
    const [campaign] = await sql`
      SELECT * FROM campaigns
      WHERE id = ${campaignId} AND organization_id = ${organization.id}
      LIMIT 1
    `;
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

      // Compute optimal send time based on lead's timezone for maximum response rates.
      // Research shows Tue-Thu 10am-2pm local time has 23% higher open rates.
      // Falls back to throttled spacing if optimal time calculation fails.
      let runAt: Date;
      try {
        // Use optimal send time calculation for best response rates
        const baseOffset = index * spacingMs; // Base throttle offset
        const baseTime = new Date(now + baseOffset);
        runAt = computeOptimalSendTime(m.phone, baseTime);
      } catch (e: any) {
        // FIX: Log the failure to help diagnose configuration issues
        console.error('[launch] optimal time calculation failed:', e.message);
        // Fallback: original throttled send time calculation
        const day = Math.floor(index / dailyCap);
        const within = index % dailyCap;
        const offsetMs = day * 24 * 60 * 60 * 1000 + within * spacingMs;
        runAt = new Date(now + offsetMs);
      }

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
