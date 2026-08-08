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

interface HourlyMetrics {
  hour: number;
  hourLabel: string;
  sent: number;
  delivered: number;
  replied: number;
  interested: number;
  responseRate: number;
  deliveryRate: number;
  qualityScore: number;
}

interface SourceROI {
  source: string;
  totalLeads: number;
  contacted: number;
  replied: number;
  interested: number;
  contracts: number;
  acquisitionCost: number;
  messagingCost: number;
  totalCost: number;
  revenue: number;
  profit: number;
  roi: number;
  costPerLead: number;
  costPerReply: number;
  costPerInterest: number;
  costPerContract: number;
  ltv: number;
  paybackRatio: number;
}

interface ABTestResult {
  testId: string;
  testName: string;
  variant: string;
  sent: number;
  delivered: number;
  replied: number;
  interested: number;
  responseRate: number;
  interestRate: number;
  confidence: number;
  isWinner: boolean;
  improvement: number | null;
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
    `.catch(() => [{}]) as any[];

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
    `.catch(() => [{}]) as any[];

    // 7. Hourly Performance Breakdown
    const hourlyData = await sql`
      SELECT
        EXTRACT(HOUR FROM me.created_at AT TIME ZONE 'America/New_York')::int as hour,
        COUNT(*)::int as sent,
        COUNT(*) FILTER (WHERE me.status IN ('delivered', 'dispatched', 'sent'))::int as delivered,
        COUNT(*) FILTER (WHERE me.status IN ('replied', 'responded'))::int as replied,
        COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM campaign_lead_queue clq
          WHERE clq.lead_id = cc.seller_lead_id::bigint
            AND clq.status = 'interested'
        ))::int as interested
      FROM message_events me
      LEFT JOIN campaign_contacts cc ON cc.id = me.contact_id
      WHERE me.created_at > now() - (${days} || ' days')::interval
        AND me.direction = 'outbound'
      GROUP BY EXTRACT(HOUR FROM me.created_at AT TIME ZONE 'America/New_York')
      ORDER BY hour
    `.catch(() => []);

    // Process hourly data with metrics
    const hourlyMetrics: HourlyMetrics[] = hourlyData.map((h: any) => {
      const sent = h.sent || 1;
      const delivered = h.delivered || 0;
      const replied = h.replied || 0;
      const interested = h.interested || 0;
      const responseRate = (replied / sent) * 100;
      const deliveryRate = (delivered / sent) * 100;
      // Quality score: weighted combination of delivery, response, and interest
      const qualityScore = Math.round(
        (deliveryRate * 0.2) + (responseRate * 0.5) + ((interested / Math.max(replied, 1)) * 100 * 0.3)
      );

      return {
        hour: h.hour,
        hourLabel: formatHourLabel(h.hour),
        sent,
        delivered,
        replied,
        interested,
        responseRate: Math.round(responseRate * 100) / 100,
        deliveryRate: Math.round(deliveryRate * 100) / 100,
        qualityScore: Math.min(qualityScore, 100),
      };
    });

    // 8. Lead Source ROI Calculation
    const sourceROIData = await sql`
      SELECT
        COALESCE(l.source, 'Unknown') as source,
        COUNT(DISTINCT l.id)::int as total_leads,
        COUNT(DISTINCT clq.lead_id)::int as contacted,
        COUNT(*) FILTER (WHERE clq.status = 'replied')::int as replied,
        COUNT(*) FILTER (WHERE clq.status = 'interested')::int as interested,
        COUNT(*) FILTER (WHERE c.esign_status = 'signed')::int as contracts,
        COALESCE(AVG(clq.expected_value) FILTER (WHERE clq.status = 'interested'), 0)::int as avg_value,
        COALESCE(SUM(ba.assignment_fee_cents) FILTER (WHERE ba.status = 'SIGNED'), 0)::bigint as revenue_cents,
        COALESCE(l.metadata->>'acquisition_cost_cents', '0')::int as acquisition_cost_cents
      FROM leads l
      LEFT JOIN campaign_lead_queue clq ON clq.lead_id = l.id
      LEFT JOIN contracts c ON c.lead_id = l.id
      LEFT JOIN buyer_assignments ba ON ba.contract_id = c.id AND ba.status = 'SIGNED'
      WHERE l.created_at > now() - (${days} || ' days')::interval
      GROUP BY COALESCE(l.source, 'Unknown'), l.metadata->>'acquisition_cost_cents'
      ORDER BY COUNT(DISTINCT l.id) DESC
    `.catch(() => []);

    // Process source ROI with full calculations
    const sourceROI: SourceROI[] = sourceROIData.map((s: any) => {
      const totalLeads = s.total_leads || 1;
      const contacted = s.contacted || 0;
      const replied = s.replied || 0;
      const interested = s.interested || 0;
      const contracts = s.contracts || 0;
      const acquisitionCostPerLead = (s.acquisition_cost_cents || 0) / 100;
      const acquisitionCost = acquisitionCostPerLead * totalLeads;
      const messagingCost = contacted * 0.007; // SMS + email estimate
      const totalCost = acquisitionCost + messagingCost;
      const revenue = (s.revenue_cents || 0) / 100;
      const profit = revenue - totalCost;
      const ltv = contracts > 0 ? revenue / contracts : 0;

      return {
        source: s.source,
        totalLeads,
        contacted,
        replied,
        interested,
        contracts,
        acquisitionCost: Math.round(acquisitionCost * 100) / 100,
        messagingCost: Math.round(messagingCost * 100) / 100,
        totalCost: Math.round(totalCost * 100) / 100,
        revenue: Math.round(revenue * 100) / 100,
        profit: Math.round(profit * 100) / 100,
        roi: totalCost > 0 ? Math.round(((revenue - totalCost) / totalCost) * 10000) / 100 : 0,
        costPerLead: totalLeads > 0 ? Math.round((totalCost / totalLeads) * 100) / 100 : 0,
        costPerReply: replied > 0 ? Math.round((totalCost / replied) * 100) / 100 : 0,
        costPerInterest: interested > 0 ? Math.round((totalCost / interested) * 100) / 100 : 0,
        costPerContract: contracts > 0 ? Math.round((totalCost / contracts) * 100) / 100 : 0,
        ltv: Math.round(ltv * 100) / 100,
        paybackRatio: totalCost > 0 ? Math.round((revenue / totalCost) * 100) / 100 : 0,
      };
    });

    // 9. A/B Test Tracking
    const abTestData = await sql`
      SELECT
        COALESCE(me.metadata->>'ab_test_id', 'none') as test_id,
        COALESCE(me.metadata->>'ab_test_name', 'No Test') as test_name,
        COALESCE(me.metadata->>'ab_variant', 'control') as variant,
        COUNT(*)::int as sent,
        COUNT(*) FILTER (WHERE me.status IN ('delivered', 'dispatched', 'sent'))::int as delivered,
        COUNT(*) FILTER (WHERE me.status IN ('replied', 'responded'))::int as replied,
        COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM campaign_lead_queue clq
          WHERE clq.lead_id = cc.seller_lead_id::bigint
            AND clq.status = 'interested'
        ))::int as interested
      FROM message_events me
      LEFT JOIN campaign_contacts cc ON cc.id = me.contact_id
      WHERE me.created_at > now() - (${days} || ' days')::interval
        AND me.direction = 'outbound'
        AND me.metadata->>'ab_test_id' IS NOT NULL
      GROUP BY
        COALESCE(me.metadata->>'ab_test_id', 'none'),
        COALESCE(me.metadata->>'ab_test_name', 'No Test'),
        COALESCE(me.metadata->>'ab_variant', 'control')
      HAVING COUNT(*) >= 50
      ORDER BY test_id, variant
    `.catch(() => []);

    // Process A/B test results with statistical significance
    const abTestResults = processABTestResults(abTestData);

    // 10. Calculate AI-Powered Insights (enhanced with new data)
    const insights = generateCampaignInsights({
      overall: overallMetrics,
      regional: regionalMetrics,
      daily: dailyTrend,
      sources: sourcePerformance,
      timing: funnelTiming[0],
      hourly: hourlyMetrics,
      sourceROI,
      abTests: abTestResults,
    });

    // 11. Cost Analysis
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

      // New: Hourly performance breakdown
      hourlyPerformance: hourlyMetrics,
      hourlyInsights: generateHourlyInsights(hourlyMetrics),

      // New: Lead source ROI analysis
      sourceROI,
      topSourcesByROI: [...sourceROI]
        .filter(s => s.contacted >= 10)
        .sort((a, b) => b.roi - a.roi)
        .slice(0, 5),
      underperformingSources: sourceROI
        .filter(s => s.contacted >= 20 && s.roi < 0),

      // New: A/B test results
      abTestResults,
      activeTests: abTestResults.filter((t, i, arr) =>
        arr.findIndex(x => x.testId === t.testId) === i
      ).length,

      aiInsights: insights,

      updatedAt: new Date().toISOString(),
    });

  } catch (error: any) {
    console.error('Advanced analytics error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

function formatHourLabel(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour === 12) return '12 PM';
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

function generateHourlyInsights(hourlyMetrics: HourlyMetrics[]): {
  bestHours: { hour: number; label: string; responseRate: number }[];
  worstHours: { hour: number; label: string; responseRate: number }[];
  recommendation: string;
  peakWindow: string;
  avoidWindow: string;
} {
  const sorted = [...hourlyMetrics]
    .filter(h => h.sent >= 10) // Need minimum sample size
    .sort((a, b) => b.responseRate - a.responseRate);

  const bestHours = sorted.slice(0, 3).map(h => ({
    hour: h.hour,
    label: h.hourLabel,
    responseRate: h.responseRate,
  }));

  const worstHours = sorted.slice(-3).reverse().map(h => ({
    hour: h.hour,
    label: h.hourLabel,
    responseRate: h.responseRate,
  }));

  // Find peak window (consecutive hours with best performance)
  const businessHours = hourlyMetrics.filter(h => h.hour >= 9 && h.hour <= 17);
  const peakStart = businessHours.length > 0
    ? businessHours.reduce((best, h) => h.responseRate > best.responseRate ? h : best, businessHours[0])
    : { hour: 10, hourLabel: '10 AM' };

  const peakWindow = `${peakStart.hourLabel} - ${formatHourLabel(Math.min(peakStart.hour + 3, 17))}`;
  const avoidWindow = worstHours.length > 0 ? `${worstHours[0].label} - ${worstHours[worstHours.length - 1]?.label || worstHours[0].label}` : 'N/A';

  const avgBest = bestHours.reduce((sum, h) => sum + h.responseRate, 0) / Math.max(bestHours.length, 1);
  const avgWorst = worstHours.reduce((sum, h) => sum + h.responseRate, 0) / Math.max(worstHours.length, 1);
  const improvement = avgWorst > 0 ? Math.round((avgBest / avgWorst - 1) * 100) : 0;

  const recommendation = bestHours.length > 0
    ? `Shift outreach volume to ${bestHours.map(h => h.label).join(', ')} for up to ${improvement}% better response rates. Avoid sending during ${avoidWindow}.`
    : 'Insufficient data for hourly optimization. Continue sending to build statistical significance.';

  return { bestHours, worstHours, recommendation, peakWindow, avoidWindow };
}

function processABTestResults(testData: any[]): ABTestResult[] {
  if (testData.length === 0) return [];

  const results: ABTestResult[] = [];
  const testGroups: Record<string, any[]> = {};

  // Group by test ID
  testData.forEach((row: any) => {
    const testId = row.test_id;
    if (!testGroups[testId]) testGroups[testId] = [];
    testGroups[testId].push(row);
  });

  // Process each test
  Object.entries(testGroups).forEach(([testId, variants]) => {
    // Find control (baseline)
    const control = variants.find(v => v.variant === 'control') || variants[0];
    const controlResponseRate = control.sent > 0 ? (control.replied / control.sent) * 100 : 0;

    variants.forEach((v: any) => {
      const sent = v.sent || 0;
      const replied = v.replied || 0;
      const interested = v.interested || 0;
      const responseRate = sent > 0 ? (replied / sent) * 100 : 0;
      const interestRate = replied > 0 ? (interested / replied) * 100 : 0;

      // Calculate statistical confidence using Z-test approximation
      const confidence = calculateConfidence(
        control.sent, control.replied,
        sent, replied
      );

      const improvement = v.variant !== 'control' && controlResponseRate > 0
        ? Math.round((responseRate / controlResponseRate - 1) * 10000) / 100
        : null;

      results.push({
        testId,
        testName: v.test_name,
        variant: v.variant,
        sent,
        delivered: v.delivered || 0,
        replied,
        interested,
        responseRate: Math.round(responseRate * 100) / 100,
        interestRate: Math.round(interestRate * 100) / 100,
        confidence: Math.round(confidence * 100) / 100,
        isWinner: confidence >= 95 && improvement !== null && improvement > 0,
        improvement,
      });
    });
  });

  return results;
}

function calculateConfidence(
  controlN: number, controlSuccess: number,
  variantN: number, variantSuccess: number
): number {
  // Two-proportion Z-test
  if (controlN === 0 || variantN === 0) return 0;

  const p1 = controlSuccess / controlN;
  const p2 = variantSuccess / variantN;
  const pPooled = (controlSuccess + variantSuccess) / (controlN + variantN);

  const se = Math.sqrt(pPooled * (1 - pPooled) * (1/controlN + 1/variantN));
  if (se === 0) return 0;

  const z = Math.abs(p2 - p1) / se;

  // Convert Z-score to confidence level (approximation)
  // Z = 1.96 -> 95%, Z = 2.58 -> 99%
  if (z >= 2.58) return 99;
  if (z >= 1.96) return 95;
  if (z >= 1.64) return 90;
  if (z >= 1.28) return 80;
  if (z >= 0.84) return 60;
  return Math.round(z * 30);
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
  hourly?: HourlyMetrics[];
  sourceROI?: SourceROI[];
  abTests?: ABTestResult[];
}): CampaignInsight[] {
  const insights: CampaignInsight[] = [];
  const { overall, regional, daily, sources, timing, hourly, sourceROI, abTests } = data;

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

  // 9. Day-of-Week Performance
  if (daily.length >= 14) {
    const dayStats: Record<string, { contacted: number; replied: number }> = {};
    daily.forEach((d: any) => {
      const dow = new Date(d.date).toLocaleDateString('en-US', { weekday: 'long' });
      if (!dayStats[dow]) dayStats[dow] = { contacted: 0, replied: 0 };
      dayStats[dow].contacted += d.contacted || 0;
      dayStats[dow].replied += d.replied || 0;
    });

    const dayRates = Object.entries(dayStats)
      .map(([day, stats]) => ({
        day,
        rate: stats.contacted > 0 ? (stats.replied / stats.contacted) * 100 : 0,
        volume: stats.contacted,
      }))
      .sort((a, b) => b.rate - a.rate);

    const bestDay = dayRates[0];
    const worstDay = dayRates[dayRates.length - 1];

    if (bestDay && worstDay && bestDay.rate > worstDay.rate * 1.5 && worstDay.volume > 20) {
      insights.push({
        category: 'opportunity',
        priority: 'medium',
        title: 'Day-of-Week Optimization',
        description: `${bestDay.day} outperforms ${worstDay.day} by ${((bestDay.rate / Math.max(worstDay.rate, 0.1)) * 100 - 100).toFixed(0)}%.`,
        metric: 'Best Day Response',
        currentValue: `${bestDay.day}: ${bestDay.rate.toFixed(1)}%`,
        benchmark: `${worstDay.day}: ${worstDay.rate.toFixed(1)}%`,
        recommendation: `Shift send volume from ${worstDay.day} to ${bestDay.day}. Consider pausing ${worstDay.day} campaigns entirely and concentrating budget on proven days.`,
        potentialImpact: `Could improve overall response by ${((bestDay.rate - responseRate) / Math.max(responseRate, 0.1) * 100).toFixed(0)}%`,
      });
    }
  }

  // 10. Channel Mix Optimization (if we have email data)
  const emailContacted = totalContacted * 0.8; // Estimate based on typical mix
  const smsContacted = totalContacted * 0.2;
  if (smsContacted > 0 && responseRate < 2) {
    insights.push({
      category: 'improvement',
      priority: 'high',
      title: 'Add SMS to Channel Mix',
      description: 'SMS has 98% open rates vs 20% for email.',
      metric: 'SMS Response Rate',
      currentValue: 'Not tracked separately',
      benchmark: '3-5% typical for SMS',
      recommendation: 'Add SMS as Day 2-3 follow-up for non-responders. Use compliant 10DLC numbers. SMS costs ~$0.0075/msg but converts 2-3x better than email alone.',
      potentialImpact: 'Multi-channel typically sees 40% higher overall response',
    });
  }

  // 11. Cost Efficiency Alert
  const costPerInterest = (overall.total_interested || 0) > 0
    ? (totalContacted * 0.007) / overall.total_interested
    : 0;

  if (costPerInterest > 50) {
    insights.push({
      category: 'warning',
      priority: 'high',
      title: 'High Cost Per Interested Lead',
      description: 'Acquisition cost exceeds $50 per interested lead.',
      metric: 'Cost Per Interest',
      currentValue: `$${costPerInterest.toFixed(2)}`,
      benchmark: '<$25 for healthy ROI',
      recommendation: 'Focus on: (1) Better lead sourcing - motivated seller lists only, (2) Message A/B testing, (3) Timing optimization (Tue-Thu 10am-2pm), (4) Remove cold lists dragging down performance.',
      potentialImpact: 'Cutting cost in half doubles effective marketing budget',
    });
  }

  // 12. Hourly Optimization Insights (NEW)
  if (hourly && hourly.length >= 6) {
    const businessHours = hourly.filter(h => h.hour >= 9 && h.hour <= 17 && h.sent >= 10);
    if (businessHours.length >= 4) {
      const avgRate = businessHours.reduce((sum, h) => sum + h.responseRate, 0) / businessHours.length;
      const best = businessHours.reduce((a, b) => a.responseRate > b.responseRate ? a : b);
      const worst = businessHours.reduce((a, b) => a.responseRate < b.responseRate ? a : b);

      if (best.responseRate > worst.responseRate * 1.5 && worst.sent >= 20) {
        insights.push({
          category: 'opportunity',
          priority: 'high',
          title: 'Hourly Send Time Optimization',
          description: `${best.hourLabel} outperforms ${worst.hourLabel} by ${Math.round((best.responseRate / Math.max(worst.responseRate, 0.1) - 1) * 100)}%.`,
          metric: 'Hourly Response Rate',
          currentValue: `Best: ${best.hourLabel} (${best.responseRate.toFixed(2)}%)`,
          benchmark: `Worst: ${worst.hourLabel} (${worst.responseRate.toFixed(2)}%)`,
          recommendation: `ACTION: In Campaign Settings > Scheduling, set Send Window to ${best.hourLabel} - ${formatHourLabel(Math.min(best.hour + 3, 17))} (ET). Disable sends during ${worst.hourLabel}. This is a quick win requiring no message changes.`,
          potentialImpact: `Concentrating sends in peak hours could add ${Math.round(totalContacted * 0.3 * (best.responseRate - avgRate) / 100)} more replies with same volume.`,
        });
      }
    }
  }

  // 13. Source ROI Insights (NEW)
  if (sourceROI && sourceROI.length >= 2) {
    const profitable = sourceROI.filter(s => s.roi > 100 && s.contacted >= 20);
    const unprofitable = sourceROI.filter(s => s.roi < 0 && s.contacted >= 30);

    if (profitable.length > 0 && unprofitable.length > 0) {
      const topSource = profitable[0];
      const worstSource = unprofitable[unprofitable.length - 1];

      insights.push({
        category: 'improvement',
        priority: 'critical',
        title: 'Reallocate Budget by Source ROI',
        description: `"${topSource.source}" has ${topSource.roi.toFixed(0)}% ROI while "${worstSource.source}" is losing money (${worstSource.roi.toFixed(0)}% ROI).`,
        metric: 'Source ROI Gap',
        currentValue: `${topSource.source}: ${topSource.roi.toFixed(0)}% ROI`,
        benchmark: `${worstSource.source}: ${worstSource.roi.toFixed(0)}% ROI`,
        recommendation: `ACTION: (1) Pause lead imports from "${worstSource.source}" immediately - you've lost $${Math.abs(worstSource.profit).toFixed(2)} on ${worstSource.contacted} contacts. (2) Double down on "${topSource.source}" - increase daily cap by 50%. (3) Request more "${topSource.source}" leads from your data provider.`,
        potentialImpact: `Reallocating ${worstSource.contacted} wasted contacts to ${topSource.source} could generate $${Math.round(worstSource.contacted * (topSource.revenue / topSource.contacted || 0))} additional revenue.`,
      });
    }

    // High-LTV source discovery
    const highLTV = sourceROI.filter(s => s.ltv > 10000 && s.contracts >= 1);
    if (highLTV.length > 0) {
      const bestLTV = highLTV[0];
      insights.push({
        category: 'success',
        priority: 'medium',
        title: 'High-Value Lead Source Identified',
        description: `"${bestLTV.source}" generates $${bestLTV.ltv.toLocaleString()} average deal value.`,
        metric: 'Lifetime Value',
        currentValue: `$${bestLTV.ltv.toLocaleString()} LTV`,
        benchmark: 'Industry avg: $8,000-12,000',
        recommendation: `ACTION: (1) Prioritize "${bestLTV.source}" leads in your queue - they close bigger deals. (2) Request segmentation data from this source to understand what makes these leads high-value. (3) Consider premium pricing tiers from this data provider for better quality.`,
        potentialImpact: 'Focusing on high-LTV sources compounds returns over time.',
      });
    }
  }

  // 14. A/B Test Action Items (NEW)
  if (abTests && abTests.length > 0) {
    const winners = abTests.filter(t => t.isWinner);
    const runningTests = [...new Set(abTests.map(t => t.testId))].length;

    if (winners.length > 0) {
      const topWinner = winners.reduce((a, b) => (b.improvement || 0) > (a.improvement || 0) ? b : a);
      insights.push({
        category: 'opportunity',
        priority: 'critical',
        title: 'A/B Test Winner Ready to Scale',
        description: `"${topWinner.testName}" variant "${topWinner.variant}" outperforms control by ${topWinner.improvement?.toFixed(1)}% with ${topWinner.confidence}% confidence.`,
        metric: 'Statistical Significance',
        currentValue: `+${topWinner.improvement?.toFixed(1)}% (${topWinner.confidence}% confidence)`,
        benchmark: '95% confidence threshold met',
        recommendation: `ACTION: (1) Go to Campaigns > Message Templates and set "${topWinner.variant}" as your default template immediately. (2) Archive the control variant. (3) Start a new test with the winner as your new baseline. Expected lift: ${topWinner.improvement?.toFixed(1)}% more replies from same volume.`,
        potentialImpact: `Scaling this winner to all sends could add ${Math.round(totalContacted * (topWinner.improvement || 0) / 100 * 0.5)} additional replies.`,
      });
    } else if (runningTests > 0) {
      const largestTest = abTests.reduce((a, b) => b.sent > a.sent ? b : a);
      const neededForSignificance = Math.max(0, 500 - largestTest.sent);

      if (neededForSignificance > 0) {
        insights.push({
          category: 'improvement',
          priority: 'low',
          title: 'A/B Test Needs More Data',
          description: `${runningTests} active test(s) running. Largest test has ${largestTest.sent} sends.`,
          metric: 'Sample Size',
          currentValue: `${largestTest.sent} sends`,
          benchmark: '~500 per variant for 95% confidence',
          recommendation: `ACTION: Continue running current tests. "${largestTest.testName}" needs approximately ${neededForSignificance} more sends per variant to reach statistical significance. Do not make changes to test parameters mid-flight.`,
          potentialImpact: 'Premature test conclusions lead to wrong decisions.',
        });
      }
    }
  }

  // 15. Composite Score Insight (NEW)
  const responseScore = Math.min((responseRate / 3) * 100, 100); // 3% = 100
  const interestScore = Math.min((interestRate / 20) * 100, 100); // 20% = 100
  const costScore = costPerInterest > 0 ? Math.max(0, 100 - (costPerInterest - 25) * 2) : 50;
  const compositeScore = Math.round(responseScore * 0.4 + interestScore * 0.4 + costScore * 0.2);

  if (compositeScore < 40) {
    insights.push({
      category: 'warning',
      priority: 'critical',
      title: 'Campaign Health Score Critical',
      description: `Overall campaign score is ${compositeScore}/100. Multiple metrics need attention.`,
      metric: 'Health Score',
      currentValue: `${compositeScore}/100`,
      benchmark: '>60 for healthy campaigns',
      recommendation: 'URGENT: Your campaign is underperforming across multiple dimensions. Recommended actions in priority order: (1) Stop spending on negative-ROI sources, (2) Implement winning A/B test variants, (3) Shift sends to peak hours, (4) Review and update message copy with personalization.',
      potentialImpact: 'Comprehensive optimization could double campaign effectiveness.',
    });
  } else if (compositeScore >= 75) {
    insights.push({
      category: 'success',
      priority: 'low',
      title: 'Strong Campaign Performance',
      description: `Campaign health score is ${compositeScore}/100. Performance is above average.`,
      metric: 'Health Score',
      currentValue: `${compositeScore}/100`,
      benchmark: 'Top quartile: >75',
      recommendation: 'MAINTAIN: Your campaign is performing well. Focus on incremental improvements: (1) Continue A/B testing to push even higher, (2) Document your winning strategies, (3) Consider scaling volume while maintaining quality.',
      potentialImpact: 'Scaling successful campaigns compounds returns.',
    });
  }

  // Sort by priority
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  insights.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return insights;
}
