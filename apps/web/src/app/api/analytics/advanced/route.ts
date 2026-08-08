/**
 * Advanced CRM Analytics API
 *
 * Provides sophisticated analytics with:
 * - Regional performance breakdown
 * - AI-powered campaign recommendations
 * - Historical trend analysis
 * - Conversion funnel deep-dive
 * - Cost efficiency metrics
 * - Predictive insights
 */

import { NextRequest } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

interface RegionalMetrics {
  state: string;
  contacted: number;
  replied: number;
  interested: number;
  contracts: number;
  responseRate: number;
  interestRate: number;
  contractRate: number;
  avgDealValue: number;
  totalRevenue: number;
  costPerLead: number;
  roi: number;
}

interface CampaignInsight {
  category: 'improvement' | 'warning' | 'success' | 'opportunity';
  priority: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  metric: string;
  currentValue: number | string;
  benchmark: number | string;
  recommendation: string;
  potentialImpact: string;
}

export async function GET(req: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: 'DATABASE_URL not configured' }, { status: 500 });
  }

  const sql = neon(process.env.DATABASE_URL);
  const searchParams = req.nextUrl.searchParams;
  const days = parseInt(searchParams.get('days') || '30');
  const campaignId = searchParams.get('campaignId');

  try {
    // 1. Overall Campaign Metrics
    const [overallMetrics] = await sql`
      SELECT
        COUNT(DISTINCT clq.lead_id)::int as total_leads,
        COUNT(*) FILTER (WHERE clq.status = 'sent')::int as total_contacted,
        COUNT(*) FILTER (WHERE clq.status = 'replied')::int as total_replied,
        COUNT(*) FILTER (WHERE clq.status = 'interested')::int as total_interested,
        COUNT(*) FILTER (WHERE clq.status = 'rejected')::int as total_rejected,
        COUNT(*) FILTER (WHERE clq.status = 'dead')::int as total_dead,
        COALESCE(AVG(clq.expected_value) FILTER (WHERE clq.status = 'interested'), 0)::int as avg_deal_value,
        COALESCE(SUM(clq.expected_value) FILTER (WHERE clq.status = 'interested'), 0)::bigint as pipeline_value,
        COUNT(DISTINCT clq.campaign_id)::int as active_campaigns,
        AVG(clq.touch_number)::numeric(4,2) as avg_touches
      FROM campaign_lead_queue clq
      WHERE clq.created_at > now() - (${days} || ' days')::interval
        ${campaignId ? sql`AND clq.campaign_id = ${campaignId}` : sql``}
    `.catch(() => [{}]);

    // 2. Regional Performance Breakdown
    const regionalData = await sql`
      SELECT
        COALESCE(l.state, 'Unknown') as state,
        COUNT(DISTINCT clq.lead_id)::int as contacted,
        COUNT(*) FILTER (WHERE clq.status = 'replied')::int as replied,
        COUNT(*) FILTER (WHERE clq.status = 'interested')::int as interested,
        COUNT(*) FILTER (WHERE c.esign_status = 'signed')::int as contracts,
        COALESCE(AVG(clq.expected_value) FILTER (WHERE clq.status = 'interested'), 0)::int as avg_deal_value,
        COALESCE(SUM(ba.assignment_fee_cents), 0)::bigint as revenue_cents
      FROM campaign_lead_queue clq
      JOIN leads l ON l.id = clq.lead_id
      LEFT JOIN contracts c ON c.lead_id = l.id
      LEFT JOIN buyer_assignments ba ON ba.contract_id = c.id AND ba.status = 'SIGNED'
      WHERE clq.created_at > now() - (${days} || ' days')::interval
      GROUP BY COALESCE(l.state, 'Unknown')
      ORDER BY COUNT(DISTINCT clq.lead_id) DESC
      LIMIT 20
    `.catch(() => []);

    // Process regional data with calculated metrics
    const regionalMetrics: RegionalMetrics[] = regionalData.map((r: any) => {
      const contacted = r.contacted || 1;
      const replied = r.replied || 0;
      const interested = r.interested || 0;
      const contracts = r.contracts || 0;
      const emailCost = contacted * 0.0001; // AWS SES
      const smsCost = contacted * 0.00645; // AWS SNS
      const totalCost = emailCost + smsCost;
      const revenue = (r.revenue_cents || 0) / 100;

      return {
        state: r.state,
        contacted,
        replied,
        interested,
        contracts,
        responseRate: (replied / contacted) * 100,
        interestRate: replied > 0 ? (interested / replied) * 100 : 0,
        contractRate: interested > 0 ? (contracts / interested) * 100 : 0,
        avgDealValue: r.avg_deal_value / 100,
        totalRevenue: revenue,
        costPerLead: totalCost / contacted,
        roi: totalCost > 0 ? ((revenue - totalCost) / totalCost) * 100 : 0,
      };
    });

    // 3. Time-series data (daily breakdown)
    const dailyTrend = await sql`
      SELECT
        DATE(clq.created_at) as date,
        COUNT(DISTINCT clq.lead_id)::int as contacted,
        COUNT(*) FILTER (WHERE clq.status = 'replied')::int as replied,
        COUNT(*) FILTER (WHERE clq.status = 'interested')::int as interested,
        COALESCE(SUM(clq.expected_value) FILTER (WHERE clq.status = 'interested'), 0)::bigint as pipeline_value
      FROM campaign_lead_queue clq
      WHERE clq.created_at > now() - (${days} || ' days')::interval
      GROUP BY DATE(clq.created_at)
      ORDER BY DATE(clq.created_at) DESC
    `.catch(() => []);

    // 4. Message Performance by Template/Type
    const messagePerformance = await sql`
      SELECT
        COALESCE(me.metadata->>'template', 'default') as template,
        COUNT(*)::int as sent,
        COUNT(*) FILTER (WHERE me.status = 'delivered')::int as delivered,
        COUNT(*) FILTER (WHERE me.status = 'opened')::int as opened,
        COUNT(*) FILTER (WHERE me.status = 'clicked')::int as clicked,
        COUNT(*) FILTER (WHERE me.status = 'replied')::int as replied
      FROM message_events me
      WHERE me.created_at > now() - (${days} || ' days')::interval
        AND me.type IN ('email', 'sms')
      GROUP BY COALESCE(me.metadata->>'template', 'default')
      ORDER BY COUNT(*) DESC
      LIMIT 10
    `.catch(() => []);

    // 5. Lead Source Performance
    const sourcePerformance = await sql`
      SELECT
        COALESCE(l.source, 'Unknown') as source,
        COUNT(DISTINCT l.id)::int as total_leads,
        COUNT(DISTINCT clq.lead_id)::int as contacted,
        COUNT(*) FILTER (WHERE clq.status = 'replied')::int as replied,
        COUNT(*) FILTER (WHERE clq.status = 'interested')::int as interested,
        COALESCE(AVG(clq.expected_value) FILTER (WHERE clq.status = 'interested'), 0)::int as avg_value
      FROM leads l
      LEFT JOIN campaign_lead_queue clq ON clq.lead_id = l.id
      WHERE l.created_at > now() - (${days} || ' days')::interval
      GROUP BY COALESCE(l.source, 'Unknown')
      ORDER BY COUNT(DISTINCT l.id) DESC
    `.catch(() => []);

    // 6. Conversion Funnel Timing
    const funnelTiming = await sql`
      SELECT
        AVG(EXTRACT(EPOCH FROM (
          CASE WHEN clq.status IN ('replied', 'interested')
          THEN clq.updated_at - clq.last_sent_at END
        )) / 3600)::numeric(6,2) as avg_hours_to_reply,
        AVG(clq.touch_number) FILTER (WHERE clq.status = 'interested')::numeric(4,2) as avg_touches_to_interest,
        AVG(clq.touch_number) FILTER (WHERE clq.status = 'replied')::numeric(4,2) as avg_touches_to_reply
      FROM campaign_lead_queue clq
      WHERE clq.created_at > now() - (${days} || ' days')::interval
    `.catch(() => [{}]);

    // 7. Calculate AI-Powered Insights
    const insights = generateCampaignInsights({
      overall: overallMetrics,
      regional: regionalMetrics,
      daily: dailyTrend,
      sources: sourcePerformance,
      timing: funnelTiming[0],
    });

    // 8. Cost Analysis
    const totalContacted = overallMetrics.total_contacted || 0;
    const emailCost = totalContacted * 0.0001;
    const smsCost = totalContacted * 0.00645;
    const totalCost = emailCost + smsCost;
    const totalRevenue = regionalMetrics.reduce((sum, r) => sum + r.totalRevenue, 0);

    return Response.json({
      period: { days, campaignId },

      summary: {
        totalLeads: overallMetrics.total_leads || 0,
        totalContacted: totalContacted,
        totalReplied: overallMetrics.total_replied || 0,
        totalInterested: overallMetrics.total_interested || 0,
        totalRejected: overallMetrics.total_rejected || 0,
        pipelineValue: (overallMetrics.pipeline_value || 0) / 100,
        avgDealValue: (overallMetrics.avg_deal_value || 0) / 100,
        avgTouches: parseFloat(overallMetrics.avg_touches) || 0,
        activeCampaigns: overallMetrics.active_campaigns || 0,
      },

      rates: {
        response: totalContacted > 0 ? ((overallMetrics.total_replied || 0) / totalContacted * 100).toFixed(2) + '%' : '0%',
        interest: (overallMetrics.total_replied || 0) > 0
          ? ((overallMetrics.total_interested || 0) / overallMetrics.total_replied * 100).toFixed(2) + '%'
          : '0%',
        rejection: totalContacted > 0 ? ((overallMetrics.total_rejected || 0) / totalContacted * 100).toFixed(2) + '%' : '0%',
      },

      costs: {
        emailCost: Math.round(emailCost * 100) / 100,
        smsCost: Math.round(smsCost * 100) / 100,
        totalCost: Math.round(totalCost * 100) / 100,
        costPerContact: totalContacted > 0 ? Math.round((totalCost / totalContacted) * 10000) / 10000 : 0,
        costPerReply: (overallMetrics.total_replied || 0) > 0
          ? Math.round((totalCost / overallMetrics.total_replied) * 100) / 100
          : 0,
        costPerInterest: (overallMetrics.total_interested || 0) > 0
          ? Math.round((totalCost / overallMetrics.total_interested) * 100) / 100
          : 0,
      },

      revenue: {
        totalRevenue,
        profit: totalRevenue - totalCost,
        roi: totalCost > 0 ? Math.round(((totalRevenue - totalCost) / totalCost) * 100) : 0,
      },

      regional: regionalMetrics,

      dailyTrend: dailyTrend.map((d: any) => ({
        date: d.date,
        contacted: d.contacted,
        replied: d.replied,
        interested: d.interested,
        pipelineValue: (d.pipeline_value || 0) / 100,
        responseRate: d.contacted > 0 ? Math.round((d.replied / d.contacted) * 10000) / 100 : 0,
      })),

      messagePerformance: messagePerformance.map((m: any) => ({
        template: m.template,
        sent: m.sent,
        delivered: m.delivered,
        opened: m.opened,
        clicked: m.clicked,
        replied: m.replied,
        openRate: m.delivered > 0 ? Math.round((m.opened / m.delivered) * 10000) / 100 : 0,
        clickRate: m.opened > 0 ? Math.round((m.clicked / m.opened) * 10000) / 100 : 0,
        replyRate: m.sent > 0 ? Math.round((m.replied / m.sent) * 10000) / 100 : 0,
      })),

      sourcePerformance: sourcePerformance.map((s: any) => ({
        source: s.source,
        totalLeads: s.total_leads,
        contacted: s.contacted,
        replied: s.replied,
        interested: s.interested,
        avgValue: (s.avg_value || 0) / 100,
        responseRate: s.contacted > 0 ? Math.round((s.replied / s.contacted) * 10000) / 100 : 0,
        qualityScore: calculateSourceQuality(s),
      })),

      timing: {
        avgHoursToReply: parseFloat(funnelTiming[0]?.avg_hours_to_reply) || null,
        avgTouchesToReply: parseFloat(funnelTiming[0]?.avg_touches_to_reply) || null,
        avgTouchesToInterest: parseFloat(funnelTiming[0]?.avg_touches_to_interest) || null,
      },

      aiInsights: insights,

      updatedAt: new Date().toISOString(),
    });

  } catch (error: any) {
    console.error('Advanced analytics error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

function calculateSourceQuality(source: any): number {
  const contacted = source.contacted || 1;
  const replied = source.replied || 0;
  const interested = source.interested || 0;

  const responseWeight = 0.3;
  const interestWeight = 0.5;
  const valueWeight = 0.2;

  const responseScore = Math.min((replied / contacted) * 100 / 5, 100); // 5% = 100 score
  const interestScore = replied > 0 ? Math.min((interested / replied) * 100 / 20, 100) : 0; // 20% = 100 score
  const valueScore = Math.min(((source.avg_value || 0) / 100) / 25000 * 100, 100); // $25K = 100 score

  return Math.round(
    responseScore * responseWeight +
    interestScore * interestWeight +
    valueScore * valueWeight
  );
}

function generateCampaignInsights(data: {
  overall: any;
  regional: RegionalMetrics[];
  daily: any[];
  sources: any[];
  timing: any;
}): CampaignInsight[] {
  const insights: CampaignInsight[] = [];
  const { overall, regional, daily, sources, timing } = data;

  const totalContacted = overall.total_contacted || 1;
  const totalReplied = overall.total_replied || 0;
  const totalInterested = overall.total_interested || 0;
  const responseRate = (totalReplied / totalContacted) * 100;
  const interestRate = totalReplied > 0 ? (totalInterested / totalReplied) * 100 : 0;

  // 1. Response Rate Analysis
  if (responseRate < 1.5) {
    insights.push({
      category: 'warning',
      priority: 'critical',
      title: 'Low Response Rate',
      description: 'Your response rate is below industry benchmark for motivated sellers.',
      metric: 'Response Rate',
      currentValue: responseRate.toFixed(2) + '%',
      benchmark: '2.5%',
      recommendation: 'Consider: (1) Improve subject lines with urgency/personalization, (2) Switch to higher-quality lead sources like tax delinquent or probate, (3) Add SMS channel for 90%+ open rates, (4) Test different send times (Tue-Thu 10am-2pm perform best).',
      potentialImpact: `Improving to 2.5% could add ${Math.round((0.025 - responseRate/100) * totalContacted)} more replies`,
    });
  } else if (responseRate >= 3) {
    insights.push({
      category: 'success',
      priority: 'low',
      title: 'Strong Response Rate',
      description: 'Your response rate exceeds industry benchmarks.',
      metric: 'Response Rate',
      currentValue: responseRate.toFixed(2) + '%',
      benchmark: '2.5%',
      recommendation: 'Maintain current messaging strategy. Consider A/B testing to push even higher.',
      potentialImpact: 'Current strategy is working well',
    });
  }

  // 2. Interest Conversion Analysis
  if (interestRate < 12) {
    insights.push({
      category: 'improvement',
      priority: 'high',
      title: 'Low Reply-to-Interest Conversion',
      description: 'Many leads who reply are not converting to interested status.',
      metric: 'Interest Rate',
      currentValue: interestRate.toFixed(2) + '%',
      benchmark: '15-20%',
      recommendation: 'Review AI reply handling: (1) Ensure counter-offers are being extracted and logged, (2) Check if responses are too generic, (3) Train AI on successful negotiation patterns from closed deals, (4) Speed up response time to under 5 minutes.',
      potentialImpact: `Improving to 15% could add ${Math.round(totalReplied * 0.03)} more interested leads`,
    });
  }

  // 3. Regional Performance Gaps
  const topRegion = regional[0];
  const underperformingRegions = regional.filter(r =>
    r.contacted > 50 && r.responseRate < (topRegion?.responseRate || 0) * 0.5
  );

  if (underperformingRegions.length > 0) {
    insights.push({
      category: 'opportunity',
      priority: 'medium',
      title: 'Regional Performance Gap',
      description: `${underperformingRegions.length} region(s) underperforming vs top market.`,
      metric: 'Regional Variance',
      currentValue: underperformingRegions.map(r => r.state).join(', '),
      benchmark: `Top: ${topRegion?.state} at ${topRegion?.responseRate.toFixed(1)}%`,
      recommendation: `Consider: (1) Regional message customization for ${underperformingRegions[0]?.state}, (2) Check compliance rules aren't blocking sends, (3) Review lead quality in these markets, (4) Test different value propositions (cash offer vs speed vs simplicity).`,
      potentialImpact: 'Closing gap could increase overall response by 20-30%',
    });
  }

  // 4. Touch Sequence Optimization
  const avgTouches = parseFloat(overall.avg_touches) || 0;
  if (avgTouches < 2.5) {
    insights.push({
      category: 'improvement',
      priority: 'high',
      title: 'Under-utilizing Follow-up Sequence',
      description: 'Average touches per lead is below optimal 3-5 touch sequence.',
      metric: 'Avg Touches',
      currentValue: avgTouches.toFixed(1),
      benchmark: '3-5 touches',
      recommendation: 'Extend follow-up sequence: Data shows 80% of deals close after touch 3+. Add Day 5 and Day 7 follow-ups with escalating urgency.',
      potentialImpact: 'Multi-touch campaigns typically see 2.3x higher conversion',
    });
  }

  // 5. Lead Source Quality
  const poorSources = sources.filter((s: any) =>
    s.contacted > 30 && (s.replied / Math.max(s.contacted, 1)) < 0.01
  );

  if (poorSources.length > 0) {
    insights.push({
      category: 'warning',
      priority: 'high',
      title: 'Low-Quality Lead Sources Identified',
      description: `${poorSources.length} lead source(s) with <1% response rate.`,
      metric: 'Source Quality',
      currentValue: poorSources.map((s: any) => s.source).join(', '),
      benchmark: '>1.5% response',
      recommendation: `Stop or reduce spend on: ${poorSources[0]?.source}. Redirect budget to motivated seller lists (tax delinquent, pre-foreclosure, probate, code violation).`,
      potentialImpact: `Reallocating ${poorSources.reduce((sum: number, s: any) => sum + s.contacted, 0)} contacts could improve ROI by 40%+`,
    });
  }

  // 6. Response Time Analysis
  const avgHoursToReply = parseFloat(timing?.avg_hours_to_reply) || 0;
  if (avgHoursToReply > 24) {
    insights.push({
      category: 'improvement',
      priority: 'medium',
      title: 'Slow Lead Response Time',
      description: 'Average response time to inbound replies exceeds 24 hours.',
      metric: 'Response Time',
      currentValue: avgHoursToReply.toFixed(1) + ' hours',
      benchmark: '<1 hour optimal, <5 hours acceptable',
      recommendation: 'Enable speed alerts for high-value replies. Leads contacted within 5 minutes are 9x more likely to convert. Consider dedicated response monitoring during business hours.',
      potentialImpact: 'Faster response can increase interest conversion by 30-50%',
    });
  }

  // 7. Pipeline Value Analysis
  const pipelineValue = (overall.pipeline_value || 0) / 100;
  const avgDealValue = (overall.avg_deal_value || 0) / 100;
  const projectedDeals = avgDealValue > 0 ? pipelineValue / avgDealValue : 0;

  if (projectedDeals >= 1) {
    insights.push({
      category: 'opportunity',
      priority: 'high',
      title: 'Active Pipeline Value',
      description: `$${pipelineValue.toLocaleString()} in pipeline from ${totalInterested} interested leads.`,
      metric: 'Pipeline',
      currentValue: `$${pipelineValue.toLocaleString()}`,
      benchmark: `${projectedDeals.toFixed(1)} projected deals`,
      recommendation: 'Focus on conversion: (1) Prioritize follow-up by expected value, (2) Schedule property visits for top 20% of pipeline, (3) Prepare assignment contract templates.',
      potentialImpact: `At 20% close rate, expect $${Math.round(pipelineValue * 0.2).toLocaleString()} revenue`,
    });
  }

  // 8. Trend Analysis
  if (daily.length >= 7) {
    const recentDays = daily.slice(0, 7);
    const olderDays = daily.slice(7, 14);

    if (olderDays.length > 0) {
      const recentResponseRate = recentDays.reduce((sum, d) => sum + (d.replied || 0), 0) /
        Math.max(recentDays.reduce((sum, d) => sum + (d.contacted || 0), 0), 1);
      const olderResponseRate = olderDays.reduce((sum, d) => sum + (d.replied || 0), 0) /
        Math.max(olderDays.reduce((sum, d) => sum + (d.contacted || 0), 0), 1);

      const trendChange = olderResponseRate > 0
        ? ((recentResponseRate - olderResponseRate) / olderResponseRate) * 100
        : 0;

      if (trendChange < -20) {
        insights.push({
          category: 'warning',
          priority: 'high',
          title: 'Declining Response Trend',
          description: 'Response rate has dropped significantly in the past week.',
          metric: 'Week-over-Week Change',
          currentValue: trendChange.toFixed(0) + '%',
          benchmark: 'Stable or improving',
          recommendation: 'Investigate: (1) Check deliverability - are emails landing in spam?, (2) Review recent message changes, (3) Verify lead quality hasn\'t degraded, (4) Check for compliance blocks.',
          potentialImpact: 'Arresting decline critical to campaign profitability',
        });
      } else if (trendChange > 20) {
        insights.push({
          category: 'success',
          priority: 'low',
          title: 'Improving Response Trend',
          description: 'Response rate has improved significantly in the past week.',
          metric: 'Week-over-Week Change',
          currentValue: '+' + trendChange.toFixed(0) + '%',
          benchmark: 'N/A',
          recommendation: 'Document what changed and double down on successful tactics.',
          potentialImpact: 'Maintain momentum to maximize campaign ROI',
        });
      }
    }
  }

  // Sort by priority
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  insights.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return insights;
}
