import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { getOrganization } from '@/lib/organization-context';
import { logFallback } from '@/app/api/utils/queryFallback';

/**
 * Weekly progress summary (defect #47, rewritten 2026-09-29 against the REAL
 * schema verified via information_schema).
 *
 * The previous version joined `outreach_log` (never existed) and
 * `inbound_messages` (never existed) and filtered `leads.stage` (the column is
 * `status`), so the FIRST query threw and one outer `.catch` answered 200 with
 * all zeros - a "working" widget that was always empty.
 *
 * Real sources now used:
 *   - contacted this/last week -> campaign_lead_queue.last_sent_at (org-scoped)
 *   - responses this/last week -> campaign_lead_queue.last_reply_at
 *   - deals in progress        -> leads.status IN ('negotiating','under_contract')
 *   - closed deals             -> leads.status = 'closed'
 *   - activity streak          -> distinct days with an outbound message_events row
 *                                 (falls back to queue sends when the ledger is empty
 *                                  would be a lie, so the ledger alone is used)
 *   - total contacted          -> distinct leads in the queue, all time
 *
 * Every query carries its own logFallback toward a zero row, so one broken
 * source degrades that ONE counter (visibly, in the log) instead of silently
 * zeroing the whole widget; the outer catch now returns 500 instead of a
 * fake-200 all-zeros payload. The response SHAPE is unchanged.
 */
export async function GET() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const org = await getOrganization();
  if (!org) {
    return Response.json({ error: 'No organization' }, { status: 403 });
  }

  try {
    // Get this week's stats (Mon-Sun)
    const now = new Date();
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const thisWeekStart = new Date(now);
    thisWeekStart.setDate(now.getDate() - mondayOffset);
    thisWeekStart.setHours(0, 0, 0, 0);

    const lastWeekStart = new Date(thisWeekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);

    const ZERO = [{ count: '0' }];

    // Contacted = a queued lead that received an outbound touch in the window.
    const [thisWeekContacted] = await sql`
      SELECT count(DISTINCT lead_id) as count
      FROM campaign_lead_queue
      WHERE organization_id = ${org.id}
        AND last_sent_at >= ${thisWeekStart.toISOString()}
    `.catch(logFallback('weekly-progress#contacted-this-week', ZERO));

    const [lastWeekContacted] = await sql`
      SELECT count(DISTINCT lead_id) as count
      FROM campaign_lead_queue
      WHERE organization_id = ${org.id}
        AND last_sent_at >= ${lastWeekStart.toISOString()}
        AND last_sent_at < ${thisWeekStart.toISOString()}
    `.catch(logFallback('weekly-progress#contacted-last-week', ZERO));

    // Responses = a queued lead that replied in the window.
    const [thisWeekResponses] = await sql`
      SELECT count(DISTINCT lead_id) as count
      FROM campaign_lead_queue
      WHERE organization_id = ${org.id}
        AND last_reply_at >= ${thisWeekStart.toISOString()}
    `.catch(logFallback('weekly-progress#responses-this-week', ZERO));

    const [lastWeekResponses] = await sql`
      SELECT count(DISTINCT lead_id) as count
      FROM campaign_lead_queue
      WHERE organization_id = ${org.id}
        AND last_reply_at >= ${lastWeekStart.toISOString()}
        AND last_reply_at < ${thisWeekStart.toISOString()}
    `.catch(logFallback('weekly-progress#responses-last-week', ZERO));

    // Deals in progress (real column: leads.status, not stage).
    const [thisWeekDeals] = await sql`
      SELECT count(*) as count
      FROM leads
      WHERE organization_id = ${org.id}
        AND status IN ('negotiating', 'under_contract')
        AND updated_at >= ${thisWeekStart.toISOString()}
    `.catch(logFallback('weekly-progress#deals-this-week', ZERO));

    const [lastWeekDeals] = await sql`
      SELECT count(*) as count
      FROM leads
      WHERE organization_id = ${org.id}
        AND status IN ('negotiating', 'under_contract')
        AND updated_at >= ${lastWeekStart.toISOString()}
        AND updated_at < ${thisWeekStart.toISOString()}
    `.catch(logFallback('weekly-progress#deals-last-week', ZERO));

    // Closed deals.
    const [thisWeekClosed] = await sql`
      SELECT count(*) as count
      FROM leads
      WHERE organization_id = ${org.id}
        AND status = 'closed'
        AND updated_at >= ${thisWeekStart.toISOString()}
    `.catch(logFallback('weekly-progress#closed-this-week', ZERO));

    const [lastWeekClosed] = await sql`
      SELECT count(*) as count
      FROM leads
      WHERE organization_id = ${org.id}
        AND status = 'closed'
        AND updated_at >= ${lastWeekStart.toISOString()}
        AND updated_at < ${thisWeekStart.toISOString()}
    `.catch(logFallback('weekly-progress#closed-last-week', ZERO));

    // Streak: consecutive days (within the last 30) with outbound activity,
    // measured from the per-message ledger.
    const [streakResult] = await sql`
      WITH daily_activity AS (
        SELECT DISTINCT DATE(created_at) as activity_date
        FROM message_events
        WHERE organization_id = ${org.id}
          AND direction = 'outbound'
          AND created_at >= NOW() - INTERVAL '30 days'
      )
      SELECT count(*) as streak
      FROM (
        SELECT activity_date,
               activity_date - (ROW_NUMBER() OVER (ORDER BY activity_date DESC))::int as grp
        FROM daily_activity
      ) grouped
      WHERE grp = (
        SELECT activity_date - (ROW_NUMBER() OVER (ORDER BY activity_date DESC))::int
        FROM daily_activity
        LIMIT 1
      )
    `.catch(logFallback('weekly-progress#streak', [{ streak: '0' }]));

    // Milestone basis: all-time distinct contacted leads in the queue.
    const [totalContacted] = await sql`
      SELECT count(DISTINCT lead_id) as count
      FROM campaign_lead_queue
      WHERE organization_id = ${org.id}
    `.catch(logFallback('weekly-progress#total-contacted', ZERO));

    let milestone = null;
    const totalContactedCount = parseInt(totalContacted.count);
    if (totalContactedCount >= 10000) {
      milestone = { type: 'leads', value: 10000, label: '10,000 leads contacted!' };
    } else if (totalContactedCount >= 5000) {
      milestone = { type: 'leads', value: 5000, label: '5,000 leads contacted!' };
    } else if (totalContactedCount >= 1000) {
      milestone = { type: 'leads', value: 1000, label: '1,000 leads contacted!' };
    } else if (totalContactedCount >= 500) {
      milestone = { type: 'leads', value: 500, label: '500 leads contacted!' };
    } else if (totalContactedCount >= 100) {
      milestone = { type: 'leads', value: 100, label: '100 leads contacted!' };
    }

    return Response.json({
      leadsContacted: parseInt(thisWeekContacted.count) || 0,
      leadsContactedLastWeek: parseInt(lastWeekContacted.count) || 0,
      responsesReceived: parseInt(thisWeekResponses.count) || 0,
      responsesLastWeek: parseInt(lastWeekResponses.count) || 0,
      dealsInProgress: parseInt(thisWeekDeals.count) || 0,
      dealsLastWeek: parseInt(lastWeekDeals.count) || 0,
      dealsClosed: parseInt(thisWeekClosed.count) || 0,
      dealsClosedLastWeek: parseInt(lastWeekClosed.count) || 0,
      streak: parseInt((streakResult as any)?.streak || '0') || 0,
      milestone,
    });
  } catch (error: any) {
    // Failures reaching here are not covered by the per-counter fallbacks;
    // a 200 full of zeros would be the defect #47 lie again.
    console.error('GET /api/dashboard/weekly-progress error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
