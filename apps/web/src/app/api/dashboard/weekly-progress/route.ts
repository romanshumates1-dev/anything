import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { getOrganization } from '@/lib/organization-context';

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

    const lastWeekEnd = new Date(thisWeekStart);
    lastWeekEnd.setMilliseconds(-1);

    // Query for this week's contacted leads
    const [thisWeekContacted] = await sql`
      SELECT count(DISTINCT l.id) as count
      FROM leads l
      JOIN outreach_log o ON o.lead_id = l.id
      WHERE l.organization_id = ${org.id}
        AND o.sent_at >= ${thisWeekStart.toISOString()}
    `;

    // Query for last week's contacted leads
    const [lastWeekContacted] = await sql`
      SELECT count(DISTINCT l.id) as count
      FROM leads l
      JOIN outreach_log o ON o.lead_id = l.id
      WHERE l.organization_id = ${org.id}
        AND o.sent_at >= ${lastWeekStart.toISOString()}
        AND o.sent_at < ${thisWeekStart.toISOString()}
    `;

    // Query for this week's responses
    const [thisWeekResponses] = await sql`
      SELECT count(*) as count
      FROM inbound_messages i
      JOIN leads l ON l.id = i.lead_id
      WHERE l.organization_id = ${org.id}
        AND i.received_at >= ${thisWeekStart.toISOString()}
    `;

    // Query for last week's responses
    const [lastWeekResponses] = await sql`
      SELECT count(*) as count
      FROM inbound_messages i
      JOIN leads l ON l.id = i.lead_id
      WHERE l.organization_id = ${org.id}
        AND i.received_at >= ${lastWeekStart.toISOString()}
        AND i.received_at < ${thisWeekStart.toISOString()}
    `;

    // Query for this week's deals in progress (negotiating stage)
    const [thisWeekDeals] = await sql`
      SELECT count(*) as count
      FROM leads
      WHERE organization_id = ${org.id}
        AND stage IN ('negotiating', 'contract')
        AND updated_at >= ${thisWeekStart.toISOString()}
    `;

    // Query for last week's deals
    const [lastWeekDeals] = await sql`
      SELECT count(*) as count
      FROM leads
      WHERE organization_id = ${org.id}
        AND stage IN ('negotiating', 'contract')
        AND updated_at >= ${lastWeekStart.toISOString()}
        AND updated_at < ${thisWeekStart.toISOString()}
    `;

    // Query for this week's closed deals
    const [thisWeekClosed] = await sql`
      SELECT count(*) as count
      FROM leads
      WHERE organization_id = ${org.id}
        AND stage = 'closed'
        AND updated_at >= ${thisWeekStart.toISOString()}
    `;

    // Query for last week's closed deals
    const [lastWeekClosed] = await sql`
      SELECT count(*) as count
      FROM leads
      WHERE organization_id = ${org.id}
        AND stage = 'closed'
        AND updated_at >= ${lastWeekStart.toISOString()}
        AND updated_at < ${thisWeekStart.toISOString()}
    `;

    // Calculate streak (days with activity)
    const [streakResult] = await sql`
      WITH daily_activity AS (
        SELECT DISTINCT DATE(o.sent_at) as activity_date
        FROM outreach_log o
        JOIN leads l ON l.id = o.lead_id
        WHERE l.organization_id = ${org.id}
          AND o.sent_at >= NOW() - INTERVAL '30 days'
        ORDER BY activity_date DESC
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
    `;

    // Check for milestones
    const [totalContacted] = await sql`
      SELECT count(DISTINCT l.id) as count
      FROM leads l
      JOIN outreach_log o ON o.lead_id = l.id
      WHERE l.organization_id = ${org.id}
    `;

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
      leadsContacted: parseInt(thisWeekContacted.count),
      leadsContactedLastWeek: parseInt(lastWeekContacted.count),
      responsesReceived: parseInt(thisWeekResponses.count),
      responsesLastWeek: parseInt(lastWeekResponses.count),
      dealsInProgress: parseInt(thisWeekDeals.count),
      dealsLastWeek: parseInt(lastWeekDeals.count),
      dealsClosed: parseInt(thisWeekClosed.count),
      dealsClosedLastWeek: parseInt(lastWeekClosed.count),
      streak: parseInt(streakResult?.streak || '0'),
      milestone,
    });
  } catch (error: any) {
    console.error('GET /api/dashboard/weekly-progress error', error);
    // Return fallback data on error
    return Response.json({
      leadsContacted: 0,
      leadsContactedLastWeek: 0,
      responsesReceived: 0,
      responsesLastWeek: 0,
      dealsInProgress: 0,
      dealsLastWeek: 0,
      dealsClosed: 0,
      dealsClosedLastWeek: 0,
      streak: 0,
      milestone: null,
    });
  }
}
