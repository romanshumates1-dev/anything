import { NextResponse } from 'next/server';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import sql from '@/app/api/utils/sql';

/**
 * POST /api/campaigns/orchestrator/daily-plan
 *
 * Creates today's email send plan by:
 * 1. Checking daily send limit from warmup config
 * 2. Pulling top EV leads from optimization pipeline
 * 3. Queuing leads into campaign_lead_queue (respecting limits)
 *
 * This is your daily planning step - run this each morning.
 */
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return NextResponse.json({ error: 'No organization found' }, { status: 403 });
  }

  try {
    // 1. Get warmup config (daily send limit)
    const [warmupConfig] = await sql`
      SELECT daily_limit, paused, paused_reason
      FROM email_warmup_config
      WHERE organization_id = ${organization.id}
    `;

    if (!warmupConfig) {
      return NextResponse.json({
        error: 'Email warmup not configured',
        action: 'Run: INSERT INTO email_warmup_config (organization_id, daily_limit) VALUES (your-org-id, 20)'
      }, { status: 400 });
    }

    if (warmupConfig.paused) {
      return NextResponse.json({
        error: 'Email sending paused',
        reason: warmupConfig.paused_reason,
        dailyLimit: warmupConfig.daily_limit
      }, { status: 400 });
    }

    const dailyLimit = warmupConfig.daily_limit;

    // 2. Get today's send count
    const [todayCounts] = await sql`
      SELECT sent_count, bounce_count, complaint_count
      FROM email_daily_sends
      WHERE organization_id = ${organization.id}
        AND date = CURRENT_DATE
    `;

    const alreadySent = todayCounts?.sent_count || 0;
    const remainingToday = Math.max(0, dailyLimit - alreadySent);

    if (remainingToday === 0) {
      return NextResponse.json({
        status: 'limit_reached',
        dailyLimit,
        sent: alreadySent,
        message: 'Daily send limit reached. Come back tomorrow or increase limit if email reputation is strong.'
      });
    }

    // 3. Pull high-EV leads from optimization pipeline
    // Only leads that:
    // - Have email
    // - Have action = 'send_email' from optimization
    // - P(close) >= 0.4 (medium-high probability)
    // - Not already in campaign queue
    const eligibleLeads = await sql`
      SELECT
        l.id as lead_id,
        l.name,
        l.email,
        l.phone,
        l.metadata->>'address' as address,
        l.metadata->>'signals' as distress_signals,
        ls.composite_score,
        pv.arv,
        pv.offer_min,
        pv.offer_max,
        dp.p_close,
        dp.expected_value
      FROM leads l
      JOIN lead_scores ls ON ls.lead_id = l.id
      JOIN property_valuations pv ON pv.lead_id = l.id
      JOIN deal_probabilities dp ON dp.lead_id = l.id
      LEFT JOIN lead_actions la ON la.lead_id = l.id
        AND la.status = 'pending'
      LEFT JOIN campaign_lead_queue clq ON clq.lead_id = l.id
      WHERE l.organization_id = ${organization.id}
        AND l.email IS NOT NULL
        AND l.email != ''
        AND la.action = 'send_email'
        AND clq.id IS NULL
        AND dp.p_close >= 0.4
      ORDER BY dp.expected_value DESC
      LIMIT ${Math.min(remainingToday * 2, 100)}
    `;

    if (eligibleLeads.length === 0) {
      return NextResponse.json({
        status: 'no_leads',
        message: 'No eligible leads found. Run optimization pipeline first: POST /api/optimization/process'
      });
    }

    // 4. Queue leads for today's batch (up to remaining limit)
    const leadsToQueue = eligibleLeads.slice(0, remainingToday);

    const queuedIds = [];
    for (const lead of leadsToQueue) {
      try {
        const [queued] = await sql`
          INSERT INTO campaign_lead_queue (
            organization_id,
            lead_id,
            expected_value,
            p_close,
            offer_min,
            offer_max,
            status,
            scheduled_for,
            touch_number
          ) VALUES (
            ${organization.id},
            ${lead.lead_id},
            ${lead.expected_value},
            ${Number(lead.p_close)},
            ${lead.offer_min},
            ${lead.offer_max},
            'queued',
            now(),
            0
          )
          RETURNING id, lead_id
        `;
        queuedIds.push(queued.id);
      } catch (error: any) {
        console.error(`Failed to queue lead ${lead.lead_id}:`, error.message);
        // Continue with others
      }
    }

    // Calculate expected outcomes
    const totalEV = leadsToQueue.reduce((sum, l) => sum + l.expected_value, 0);
    const avgPClose = leadsToQueue.reduce((sum, l) => sum + Number(l.p_close), 0) / leadsToQueue.length;
    const expectedReplies = Math.round(avgPClose * leadsToQueue.length * 0.5); // 50% of P(close) = reply rate estimate

    return NextResponse.json({
      status: 'plan_created',
      summary: {
        dailyLimit,
        alreadySent,
        remainingToday,
        leadsQueued: queuedIds.length,
        eligibleLeadsFound: eligibleLeads.length
      },
      economics: {
        totalExpectedValueDollars: Math.round(totalEV / 100),
        avgPClose: Math.round(avgPClose * 1000) / 1000,
        expectedReplies,
        expectedPositiveReplies: Math.round(expectedReplies * 0.25) // 25% of replies are positive
      },
      nextStep: 'Run: POST /api/campaigns/orchestrator/execute-sends',
      queuedLeadIds: queuedIds
    });

  } catch (error: any) {
    console.error('POST /api/campaigns/orchestrator/daily-plan error', error);
    return NextResponse.json(
      { error: 'Failed to create daily plan' },
      { status: 500 }
    );
  }
}
