/**
 * GET /api/campaigns/profit
 *
 * Profit calculator dashboard data - like TopStep's profit calculator
 * Shows: spend vs revenue, break-even point, ROI, conversion rates
 */
import { NextRequest } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

// Cost constants
const COSTS = {
  email: 0.0001,        // AWS SES: $0.10 per 1,000
  rcs: 0.007,           // AWS RCS avg
  sms: 0.0079,          // SMS fallback
  smsFallback: 0.015,   // RCS + SMS fallback
};

export async function GET(req: NextRequest) {
  try {
    if (!process.env.DATABASE_URL) {
      return Response.json({ error: 'DATABASE_URL not configured' }, { status: 500 });
    }

    const sql = neon(process.env.DATABASE_URL);

    // Get campaign metrics
    const [metrics] = await sql`
      SELECT
        -- Outreach counts
        (SELECT COUNT(*)::int FROM campaign_lead_queue WHERE status = 'sent') as total_contacted,
        (SELECT COUNT(*)::int FROM campaign_lead_queue WHERE status = 'replied') as total_replied,
        (SELECT COUNT(*)::int FROM campaign_lead_queue WHERE status = 'interested') as total_interested,
        (SELECT COUNT(*)::int FROM campaign_lead_queue WHERE status = 'queued') as total_queued,

        -- Value metrics
        (SELECT COALESCE(SUM(expected_value), 0)::bigint FROM campaign_lead_queue WHERE status = 'interested') as pipeline_value,
        (SELECT COALESCE(AVG(expected_value), 0)::int FROM campaign_lead_queue WHERE status = 'interested') as avg_deal_value,

        -- Message counts by type (from jobs)
        (SELECT COUNT(*)::int FROM jobs WHERE type = 'send_email' AND status = 'completed') as emails_sent,
        (SELECT COUNT(*)::int FROM jobs WHERE type = 'send_sms' AND status = 'completed') as sms_sent,

        -- Won deals (from leads metadata or queue)
        (SELECT COUNT(*)::int FROM leads WHERE metadata->>'phase' = 'won') as deals_won,
        (SELECT COALESCE(SUM((metadata->>'assignmentFee')::int), 0)::bigint FROM leads WHERE metadata->>'phase' = 'won') as revenue_collected
    `;

    // Calculate costs
    const emailCost = (metrics.emails_sent || 0) * COSTS.email;
    const smsCost = (metrics.sms_sent || 0) * COSTS.sms;
    const totalSpend = emailCost + smsCost;

    // Calculate conversion funnel
    const contacted = metrics.total_contacted || 1;
    const replied = metrics.total_replied || 0;
    const interested = metrics.total_interested || 0;
    const won = metrics.deals_won || 0;

    const replyRate = (replied / contacted) * 100;
    const interestRate = replied > 0 ? (interested / replied) * 100 : 0;
    const closeRate = interested > 0 ? (won / interested) * 100 : 0;
    const overallConversion = (won / contacted) * 100;

    // Revenue and profit
    const revenue = metrics.revenue_collected || 0;
    const profit = revenue - totalSpend;
    const roi = totalSpend > 0 ? ((revenue - totalSpend) / totalSpend) * 100 : 0;

    // Break-even analysis
    const avgDealValue = metrics.avg_deal_value || 15000;
    const costPerContact = totalSpend / contacted;
    const contactsNeededForDeal = overallConversion > 0 ? Math.ceil(100 / overallConversion) : 1000;
    const costPerDeal = costPerContact * contactsNeededForDeal;
    const breakEvenDeals = totalSpend > 0 ? Math.ceil(totalSpend / avgDealValue) : 0;

    // Projections
    const pipelineValue = metrics.pipeline_value || 0;
    const projectedRevenue = pipelineValue * (closeRate / 100 || 0.1);
    const projectedProfit = projectedRevenue - totalSpend;

    // Daily metrics (last 7 days)
    const dailyMetrics = await sql`
      SELECT
        DATE(created_at) as date,
        COUNT(*) FILTER (WHERE status = 'sent')::int as contacted,
        COUNT(*) FILTER (WHERE status = 'replied')::int as replied,
        COUNT(*) FILTER (WHERE status = 'interested')::int as interested
      FROM campaign_lead_queue
      WHERE created_at > now() - interval '7 days'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `;

    return Response.json({
      // Summary metrics
      summary: {
        totalSpend: Math.round(totalSpend * 100) / 100,
        totalRevenue: revenue,
        profit: profit,
        roi: Math.round(roi * 10) / 10,
        pipelineValue: pipelineValue,
        projectedProfit: Math.round(projectedProfit),
      },

      // Spend breakdown
      costs: {
        email: { count: metrics.emails_sent, cost: Math.round(emailCost * 100) / 100 },
        sms: { count: metrics.sms_sent, cost: Math.round(smsCost * 100) / 100 },
        total: Math.round(totalSpend * 100) / 100,
        perContact: Math.round(costPerContact * 10000) / 10000,
        perDeal: Math.round(costPerDeal * 100) / 100,
      },

      // Conversion funnel
      funnel: {
        queued: metrics.total_queued,
        contacted: contacted,
        replied: replied,
        interested: interested,
        won: won,
        rates: {
          reply: Math.round(replyRate * 10) / 10,
          interest: Math.round(interestRate * 10) / 10,
          close: Math.round(closeRate * 10) / 10,
          overall: Math.round(overallConversion * 100) / 100,
        },
      },

      // Break-even analysis
      breakEven: {
        dealsNeeded: breakEvenDeals,
        contactsPerDeal: contactsNeededForDeal,
        costPerDeal: Math.round(costPerDeal * 100) / 100,
        avgDealValue: avgDealValue,
        atCurrentRate: {
          contactsNeeded: breakEvenDeals * contactsNeededForDeal,
          estimatedCost: Math.round(breakEvenDeals * costPerDeal * 100) / 100,
        },
      },

      // Profit scenarios
      scenarios: {
        worst: {
          label: 'Net Negative (No Deals)',
          value: -totalSpend,
          description: 'If campaign produces zero deals',
        },
        breakEven: {
          label: 'Break Even',
          deals: breakEvenDeals,
          value: 0,
          description: `Need ${breakEvenDeals} deal(s) at $${avgDealValue.toLocaleString()} avg`,
        },
        current: {
          label: 'Current',
          deals: won,
          value: profit,
          description: won > 0 ? `${won} deal(s) closed` : 'No deals yet',
        },
        projected: {
          label: 'Projected (Pipeline)',
          deals: Math.round(interested * (closeRate / 100 || 0.1)),
          value: Math.round(projectedProfit),
          description: `Based on ${interested} interested leads`,
        },
        best: {
          label: 'Best Case (All Pipeline)',
          deals: interested,
          value: pipelineValue - totalSpend,
          description: 'If all interested leads close',
        },
      },

      // Daily trend
      daily: dailyMetrics,

      // Timestamp
      updatedAt: new Date().toISOString(),
    });

  } catch (error: any) {
    console.error('GET /api/campaigns/profit error', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
