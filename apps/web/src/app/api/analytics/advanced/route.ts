/**
 * Advanced CRM Analytics API
 *
 * Provides sophisticated analytics with:
 * - Hierarchical geographic analytics (state -> county -> zip)
 * - Thompson Sampling multi-armed bandit for A/B test allocation
 * - Hierarchical Bayesian model with source-specific priors
 * - AI-powered recommendations with ROI projections
 * - Visual funnel with drop-off analysis
 * - Cross-dimensional time analysis (day x hour patterns)
 * - Consent-to-conversion tracking
 */

import { NextRequest } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

// --- Type Definitions ---

interface HierarchicalGeoMetrics {
  level: 'state' | 'county' | 'zip';
  state: string;
  county?: string;
  zip?: string;
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
  // Hierarchical drill-down support
  children?: HierarchicalGeoMetrics[];
  parentPath?: string;
}

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
  // Thompson Sampling bandit allocation
  thompsonProbability?: number;
  recommendedAllocation?: number;
  // Sequential testing
  canStopEarly?: boolean;
  expectedLoss?: number;
}

interface BanditAllocation {
  testId: string;
  testName: string;
  variants: {
    variant: string;
    currentAllocation: number;
    recommendedAllocation: number;
    probabilityOfBest: number;
    expectedValue: number;
  }[];
  totalSamples: number;
  minimumSampleSize: number;
  canStopEarly: boolean;
  stoppingReason?: string;
}

interface FunnelStage {
  stage: string;
  count: number;
  dropOffCount: number;
  dropOffPercent: number;
  conversionToNext: number;
  cumulativeConversion: number;
  avgTimeInStage?: number;
  // Visual funnel dimensions
  widthPercent: number;
}

interface ConsentConversionMetrics {
  consentMethod: string;
  totalLeads: number;
  replied: number;
  interested: number;
  contracted: number;
  conversionRate: number;
  comparedToAverage: number;
  legalStrength: 'strong' | 'moderate' | 'weak';
}

interface ROIProjection {
  metric: string;
  currentValue: number;
  projectedValue: number;
  projectedAdditionalReplies: number;
  projectedAdditionalDeals: number;
  projectedRevenueImpact: number;
  confidenceRange: { low: number; high: number };
}

interface EnhancedRecommendation {
  category: 'improvement' | 'warning' | 'success' | 'opportunity';
  priority: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  metric: string;
  currentValue: number | string;
  benchmark: number | string;
  recommendation: string;
  potentialImpact: string;
  // NEW: ROI projections
  roiProjection?: ROIProjection;
  // NEW: Data confidence
  confidence: 'high' | 'medium' | 'low' | 'insufficient';
  sampleSize: number;
  minSampleSizeNeeded: number;
  // NEW: Specific data citations
  dataCitations: string[];
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
  // Enhanced fields
  roiProjection?: ROIProjection;
  confidence?: 'high' | 'medium' | 'low' | 'insufficient';
  sampleSize?: number;
  dataCitations?: string[];
}

interface CrossDimensionalPattern {
  dayOfWeek: string;
  hour: number;
  sent: number;
  replied: number;
  responseRate: number;
  qualityScore: number;
  isOptimal: boolean;
}

// Bayesian prior weights by lead source type
const LEAD_SOURCE_PRIORS: Record<string, { alpha: number; beta: number; description: string }> = {
  coldList: { alpha: 1, beta: 49, description: 'Cold lists: ~2% expected response' },
  warmList: { alpha: 2, beta: 48, description: 'Warm lists: ~4% expected response' },
  motivatedSeller: { alpha: 3, beta: 47, description: 'Motivated sellers: ~6% expected response' },
  highDistress: { alpha: 4, beta: 46, description: 'High distress (probate/foreclosure): ~8% expected response' },
  inbound: { alpha: 5, beta: 45, description: 'Inbound leads: ~10% expected response' },
  default: { alpha: 1.5, beta: 48.5, description: 'Default prior: ~3% expected response' },
};

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

    // 2. Regional Performance Breakdown (basic state level)
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

    // 2b. Hierarchical Geographic Analytics (state -> county -> zip)
    // Uses GROUPING SETS for efficient single-scan aggregation
    const hierarchicalGeoData = await sql`
      WITH geo_base AS (
        SELECT
          COALESCE(l.state, 'Unknown') as state,
          COALESCE(l.metadata->>'county', l.metadata->>'property_county', 'Unknown') as county,
          COALESCE(l.metadata->>'zip', l.metadata->>'property_zip', SUBSTRING(l.metadata->>'address' FROM '\\d{5}$'), 'Unknown') as zip,
          clq.lead_id,
          clq.status,
          clq.expected_value,
          c.esign_status,
          ba.assignment_fee_cents
        FROM campaign_lead_queue clq
        JOIN leads l ON l.id = clq.lead_id
        LEFT JOIN contracts c ON c.lead_id = l.id
        LEFT JOIN buyer_assignments ba ON ba.contract_id = c.id AND ba.status = 'SIGNED'
        WHERE clq.created_at > now() - (${days} || ' days')::interval
      )
      SELECT
        CASE
          WHEN GROUPING(state) = 1 THEN 'total'
          WHEN GROUPING(county) = 1 THEN 'state'
          WHEN GROUPING(zip) = 1 THEN 'county'
          ELSE 'zip'
        END as level,
        state,
        county,
        zip,
        COUNT(DISTINCT lead_id)::int as contacted,
        COUNT(*) FILTER (WHERE status = 'replied')::int as replied,
        COUNT(*) FILTER (WHERE status = 'interested')::int as interested,
        COUNT(*) FILTER (WHERE esign_status = 'signed')::int as contracts,
        COALESCE(AVG(expected_value) FILTER (WHERE status = 'interested'), 0)::int as avg_deal_value,
        COALESCE(SUM(assignment_fee_cents), 0)::bigint as revenue_cents
      FROM geo_base
      GROUP BY GROUPING SETS (
        (),
        (state),
        (state, county),
        (state, county, zip)
      )
      HAVING COUNT(DISTINCT lead_id) >= 5
      ORDER BY
        CASE WHEN GROUPING(state) = 1 THEN 0 ELSE 1 END,
        state,
        CASE WHEN GROUPING(county) = 1 THEN 0 ELSE 1 END,
        county,
        COUNT(DISTINCT lead_id) DESC
      LIMIT 200
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

    // 10. Cross-Dimensional Time Analysis (day-of-week x hour)
    const crossDimensionalTime = await sql`
      SELECT
        to_char(me.created_at AT TIME ZONE 'America/New_York', 'Day') as day_of_week,
        EXTRACT(DOW FROM me.created_at AT TIME ZONE 'America/New_York')::int as day_num,
        EXTRACT(HOUR FROM me.created_at AT TIME ZONE 'America/New_York')::int as hour,
        COUNT(*)::int as sent,
        COUNT(*) FILTER (WHERE me.status IN ('replied', 'responded'))::int as replied
      FROM message_events me
      WHERE me.created_at > now() - (${days} || ' days')::interval
        AND me.direction = 'outbound'
      GROUP BY
        to_char(me.created_at AT TIME ZONE 'America/New_York', 'Day'),
        EXTRACT(DOW FROM me.created_at AT TIME ZONE 'America/New_York'),
        EXTRACT(HOUR FROM me.created_at AT TIME ZONE 'America/New_York')
      HAVING COUNT(*) >= 10
      ORDER BY day_num, hour
    `.catch(() => []);

    // 11. Consent-to-Conversion Funnel
    const consentConversionData = await sql`
      SELECT
        COALESCE(cr.metadata->>'consentMethod', 'unknown') as consent_method,
        COUNT(DISTINCT l.id)::int as total_leads,
        COUNT(DISTINCT clq.lead_id) FILTER (WHERE clq.status = 'replied')::int as replied,
        COUNT(DISTINCT clq.lead_id) FILTER (WHERE clq.status = 'interested')::int as interested,
        COUNT(DISTINCT c.id) FILTER (WHERE c.esign_status = 'signed')::int as contracted
      FROM compliance_records cr
      JOIN leads l ON l.phone = cr.target OR l.email = cr.target
      LEFT JOIN campaign_lead_queue clq ON clq.lead_id = l.id
      LEFT JOIN contracts c ON c.lead_id = l.id
      WHERE cr.type = 'consent'
        AND cr.created_at > now() - (${days} || ' days')::interval
      GROUP BY COALESCE(cr.metadata->>'consentMethod', 'unknown')
      HAVING COUNT(DISTINCT l.id) >= 5
      ORDER BY COUNT(DISTINCT l.id) DESC
    `.catch(() => []);

    // 12. Buyer Pipeline Metrics
    const buyerMetricsData = await sql`
      SELECT
        COUNT(DISTINCT b.id)::int as total_buyers,
        COUNT(DISTINCT b.id) FILTER (WHERE b.actual_close_count >= 3)::int as vip_buyers,
        COUNT(DISTINCT b.id) FILTER (WHERE b.verified = true OR b.pof_submitted = true)::int as verified_buyers,
        COUNT(DISTINCT ba.id)::int as total_assignments,
        COUNT(DISTINCT ba.id) FILTER (WHERE ba.status = 'pending')::int as pending_assignments,
        COUNT(DISTINCT ba.id) FILTER (WHERE ba.status = 'SIGNED')::int as completed_deals,
        COALESCE(AVG(ba.assignment_fee_cents) FILTER (WHERE ba.status = 'SIGNED'), 0)::int as avg_assignment_fee_cents,
        COALESCE(AVG(EXTRACT(DAY FROM (ba.updated_at - ba.created_at))) FILTER (WHERE ba.status = 'SIGNED'), 0)::int as avg_close_days
      FROM buyers b
      LEFT JOIN buyer_assignments ba ON ba.buyer_id = b.id
      WHERE b.created_at > now() - (${days} || ' days')::interval
        OR ba.created_at > now() - (${days} || ' days')::interval
    `.catch(() => [{}]) as any[];

    // 13. Seller Pipeline Metrics
    const sellerMetricsData = await sql`
      SELECT
        COUNT(DISTINCT l.id)::int as total_leads,
        COUNT(DISTINCT clq.lead_id)::int as contacted,
        COUNT(*) FILTER (WHERE clq.status = 'replied')::int as replied,
        COUNT(*) FILTER (WHERE clq.status = 'interested')::int as interested,
        COUNT(DISTINCT c.id) FILTER (WHERE c.esign_status = 'signed')::int as contracted,
        COALESCE(AVG(EXTRACT(EPOCH FROM (clq.updated_at - clq.last_sent_at)) / 3600) FILTER (WHERE clq.status = 'replied'), 0)::numeric(6,2) as avg_response_hours,
        COALESCE(AVG(clq.touch_number) FILTER (WHERE clq.status = 'interested'), 0)::numeric(4,2) as avg_touches_to_interest
      FROM leads l
      LEFT JOIN campaign_lead_queue clq ON clq.lead_id = l.id
      LEFT JOIN contracts c ON c.lead_id = l.id
      WHERE l.created_at > now() - (${days} || ' days')::interval
    `.catch(() => [{}]) as any[];

    // 14. Top Lead Sources for Seller Pipeline
    const topSourcesData = await sql`
      SELECT
        COALESCE(l.source, 'Unknown') as source,
        COUNT(DISTINCT l.id)::int as leads,
        COUNT(DISTINCT c.id) FILTER (WHERE c.esign_status = 'signed')::int as contracts,
        ROUND(COUNT(DISTINCT c.id) FILTER (WHERE c.esign_status = 'signed')::numeric /
              NULLIF(COUNT(DISTINCT l.id), 0) * 100, 2) as contract_rate
      FROM leads l
      LEFT JOIN contracts c ON c.lead_id = l.id
      WHERE l.created_at > now() - (${days} || ' days')::interval
      GROUP BY COALESCE(l.source, 'Unknown')
      HAVING COUNT(DISTINCT l.id) >= 10
      ORDER BY contract_rate DESC NULLS LAST
      LIMIT 5
    `.catch(() => []);

    // 15. Visual Funnel with Drop-off Analysis
    const funnelData = await sql`
      WITH stage_counts AS (
        SELECT
          CASE
            WHEN clq.status = 'pending' THEN 1
            WHEN clq.status = 'sent' THEN 2
            WHEN clq.status = 'delivered' THEN 3
            WHEN clq.status = 'replied' THEN 4
            WHEN clq.status = 'interested' THEN 5
            WHEN clq.status = 'negotiating' THEN 6
            ELSE 0
          END as stage_order,
          clq.status as stage,
          COUNT(DISTINCT clq.lead_id)::int as count
        FROM campaign_lead_queue clq
        WHERE clq.created_at > now() - (${days} || ' days')::interval
        GROUP BY clq.status
      ),
      contract_stage AS (
        SELECT 7 as stage_order, 'contracted' as stage, COUNT(DISTINCT lead_id)::int as count
        FROM contracts
        WHERE created_at > now() - (${days} || ' days')::interval
      )
      SELECT stage_order, stage, count
      FROM stage_counts
      WHERE stage_order > 0
      UNION ALL
      SELECT * FROM contract_stage
      ORDER BY stage_order
    `.catch(() => []);

    // Process A/B test results with statistical significance AND Thompson Sampling
    const abTestResults = processABTestResults(abTestData);
    const banditAllocations = calculateThompsonSamplingAllocations(abTestData);

    // Process hierarchical geo data
    const hierarchicalGeo = processHierarchicalGeoData(hierarchicalGeoData);

    // Process cross-dimensional time patterns
    const crossDimensionalPatterns = processCrossDimensionalTime(crossDimensionalTime);

    // Process consent conversion data
    const consentMetrics = processConsentConversion(consentConversionData);

    // Process visual funnel
    const visualFunnel = processVisualFunnel(funnelData);

    // Calculate system-wide metrics for Bayesian priors
    const systemPrior = {
      totalSent: overallMetrics.total_contacted || 0,
      totalReplied: overallMetrics.total_replied || 0,
      avgResponseRate: (overallMetrics.total_replied || 0) / Math.max(overallMetrics.total_contacted || 1, 1),
      avgDealValue: (overallMetrics.avg_deal_value || 0) / 100,
    };

    // 13. Calculate AI-Powered Insights (enhanced with ROI projections and confidence)
    const insights = generateEnhancedInsights({
      overall: overallMetrics,
      regional: regionalMetrics,
      daily: dailyTrend,
      sources: sourcePerformance,
      timing: funnelTiming[0],
      hourly: hourlyMetrics,
      sourceROI,
      abTests: abTestResults,
      crossDimensional: crossDimensionalPatterns,
      consentMetrics,
      systemPrior,
    });

    // 14. Cost Analysis
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

      // New: A/B test results with Thompson Sampling
      abTestResults,
      activeTests: abTestResults.filter((t, i, arr) =>
        arr.findIndex(x => x.testId === t.testId) === i
      ).length,
      banditAllocations, // Thompson Sampling recommended allocations

      // NEW: Hierarchical Geographic Analytics (state -> county -> zip)
      hierarchicalGeo: {
        summary: hierarchicalGeo.summary,
        states: hierarchicalGeo.states,
        topCounties: hierarchicalGeo.topCounties,
        topZips: hierarchicalGeo.topZips,
        drillDownAvailable: hierarchicalGeo.drillDownAvailable,
      },

      // NEW: Cross-Dimensional Time Analysis (day x hour)
      crossDimensionalTime: {
        patterns: crossDimensionalPatterns.patterns,
        optimalSlots: crossDimensionalPatterns.optimalSlots,
        avoidSlots: crossDimensionalPatterns.avoidSlots,
        heatmapData: crossDimensionalPatterns.heatmapData,
        recommendation: crossDimensionalPatterns.recommendation,
      },

      // NEW: Consent-to-Conversion Analysis
      consentConversion: {
        methods: consentMetrics.methods,
        bestMethod: consentMetrics.bestMethod,
        complianceInsight: consentMetrics.insight,
      },

      // NEW: Visual Funnel with Drop-off Analysis
      visualFunnel: {
        stages: visualFunnel.stages,
        totalDropOff: visualFunnel.totalDropOff,
        biggestBottleneck: visualFunnel.biggestBottleneck,
        funnelEfficiency: visualFunnel.efficiency,
      },

      // Buyer Pipeline Metrics
      buyerMetrics: {
        totalBuyers: buyerMetricsData[0]?.total_buyers || 0,
        vipBuyers: buyerMetricsData[0]?.vip_buyers || 0,
        verifiedBuyers: buyerMetricsData[0]?.verified_buyers || 0,
        totalAssignments: buyerMetricsData[0]?.total_assignments || 0,
        pendingAssignments: buyerMetricsData[0]?.pending_assignments || 0,
        completedDeals: buyerMetricsData[0]?.completed_deals || 0,
        avgAssignmentFee: (buyerMetricsData[0]?.avg_assignment_fee_cents || 0) / 100,
        avgCloseTime: buyerMetricsData[0]?.avg_close_days || 0,
      },

      // Seller Pipeline Metrics
      sellerMetrics: {
        totalLeads: sellerMetricsData[0]?.total_leads || 0,
        contacted: sellerMetricsData[0]?.contacted || 0,
        replied: sellerMetricsData[0]?.replied || 0,
        interested: sellerMetricsData[0]?.interested || 0,
        contracted: sellerMetricsData[0]?.contracted || 0,
        avgResponseTime: parseFloat(sellerMetricsData[0]?.avg_response_hours) || 0,
        avgTouchesToInterest: parseFloat(sellerMetricsData[0]?.avg_touches_to_interest) || 0,
        topSources: topSourcesData.map((s: any) => ({
          source: s.source,
          leads: s.leads,
          contractRate: parseFloat(s.contract_rate) || 0,
        })),
      },

      // Enhanced AI Insights with ROI projections and confidence scores
      aiInsights: insights,

      // Data quality indicators
      dataQuality: {
        totalSampleSize: totalContacted,
        sufficientForAnalysis: totalContacted >= 100,
        sufficientForABTests: totalContacted >= 500,
        recommendedMinimum: 500,
        confidenceLevel: totalContacted >= 1000 ? 'high' : totalContacted >= 500 ? 'medium' : totalContacted >= 100 ? 'low' : 'insufficient',
      },

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

// --- Thompson Sampling Multi-Armed Bandit ---
function calculateThompsonSamplingAllocations(testData: any[]): BanditAllocation[] {
  if (testData.length === 0) return [];

  const allocations: BanditAllocation[] = [];
  const testGroups: Record<string, any[]> = {};

  // Group by test ID
  testData.forEach((row: any) => {
    const testId = row.test_id;
    if (!testGroups[testId]) testGroups[testId] = [];
    testGroups[testId].push(row);
  });

  Object.entries(testGroups).forEach(([testId, variants]) => {
    // Calculate Thompson Sampling posteriors using Beta distribution
    // Beta(alpha, beta) where alpha = successes + 1, beta = failures + 1
    const variantStats = variants.map((v: any) => {
      const successes = v.replied || 0;
      const failures = (v.sent || 0) - successes;
      const alpha = successes + 1; // Prior: Beta(1,1) = uniform
      const beta = failures + 1;

      // Approximate expected value: alpha / (alpha + beta)
      const expectedValue = alpha / (alpha + beta);

      // Sample from Beta distribution (approximation using mean and variance)
      // For actual Thompson Sampling, you'd sample; here we use expected value
      return {
        variant: v.variant,
        sent: v.sent || 0,
        replied: successes,
        alpha,
        beta,
        expectedValue,
        currentAllocation: 0, // Will calculate below
      };
    });

    // Calculate probability of being the best variant via simulation
    const numSimulations = 10000;
    const winCounts: Record<string, number> = {};
    variantStats.forEach(v => { winCounts[v.variant] = 0; });

    for (let i = 0; i < numSimulations; i++) {
      let bestVariant = '';
      let bestSample = -1;

      variantStats.forEach(v => {
        // Sample from Beta distribution (approximation using jitter around mean)
        const sample = sampleBeta(v.alpha, v.beta);
        if (sample > bestSample) {
          bestSample = sample;
          bestVariant = v.variant;
        }
      });

      if (bestVariant) winCounts[bestVariant]++;
    }

    // Calculate recommended allocations based on probability of being best
    const totalSamples = variantStats.reduce((sum, v) => sum + v.sent, 0);
    const variantsWithAllocation = variantStats.map(v => {
      const probabilityOfBest = winCounts[v.variant] / numSimulations;
      return {
        variant: v.variant,
        currentAllocation: totalSamples > 0 ? Math.round((v.sent / totalSamples) * 100) : 0,
        recommendedAllocation: Math.round(probabilityOfBest * 100),
        probabilityOfBest: Math.round(probabilityOfBest * 1000) / 10,
        expectedValue: Math.round(v.expectedValue * 10000) / 100,
      };
    });

    // Determine if we can stop early (one variant has >95% probability)
    const maxProb = Math.max(...variantsWithAllocation.map(v => v.probabilityOfBest));
    const canStopEarly = maxProb >= 95 && totalSamples >= 200;
    const minimumSampleSize = calculateMinimumSampleSize(variantStats);

    allocations.push({
      testId,
      testName: variants[0]?.test_name || 'Unknown Test',
      variants: variantsWithAllocation,
      totalSamples,
      minimumSampleSize,
      canStopEarly,
      stoppingReason: canStopEarly
        ? `Variant "${variantsWithAllocation.find(v => v.probabilityOfBest === maxProb)?.variant}" has ${maxProb}% probability of being best`
        : totalSamples < minimumSampleSize
          ? `Need ${minimumSampleSize - totalSamples} more samples for reliable results`
          : undefined,
    });
  });

  return allocations;
}

// Simple Beta distribution sampler (Box-Muller transform approximation)
function sampleBeta(alpha: number, beta: number): number {
  // Use the fact that Beta can be expressed via Gamma distributions
  // Simplified: use mean with some variance
  const mean = alpha / (alpha + beta);
  const variance = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1));
  const stdDev = Math.sqrt(variance);

  // Sample using normal approximation with bounds
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const sample = mean + z * stdDev;

  return Math.max(0, Math.min(1, sample));
}

// Calculate minimum sample size for A/B test
function calculateMinimumSampleSize(variants: any[]): number {
  // Using power analysis: n = 2 * (z_alpha + z_beta)^2 * p * (1-p) / MDE^2
  // z_alpha = 1.96 (95% confidence), z_beta = 0.84 (80% power)
  // MDE = 20% relative improvement (default)
  const baseRate = variants.reduce((sum, v) => sum + v.expectedValue, 0) / variants.length;
  const mde = baseRate * 0.2; // 20% relative MDE
  const p = baseRate;

  if (mde === 0 || p === 0) return 500; // Default

  const zAlpha = 1.96;
  const zBeta = 0.84;
  const n = 2 * Math.pow(zAlpha + zBeta, 2) * p * (1 - p) / Math.pow(mde, 2);

  return Math.max(100, Math.min(10000, Math.ceil(n)));
}

// --- Hierarchical Geographic Data Processing ---
function processHierarchicalGeoData(data: any[]): {
  summary: HierarchicalGeoMetrics | null;
  states: HierarchicalGeoMetrics[];
  topCounties: HierarchicalGeoMetrics[];
  topZips: HierarchicalGeoMetrics[];
  drillDownAvailable: boolean;
} {
  const summary = data.find((d: any) => d.level === 'total');
  const states = data.filter((d: any) => d.level === 'state');
  const counties = data.filter((d: any) => d.level === 'county');
  const zips = data.filter((d: any) => d.level === 'zip');

  const processRow = (r: any): HierarchicalGeoMetrics => {
    const contacted = r.contacted || 1;
    const replied = r.replied || 0;
    const interested = r.interested || 0;
    const contracts = r.contracts || 0;
    const emailCost = contacted * 0.0001;
    const smsCost = contacted * 0.00645;
    const totalCost = emailCost + smsCost;
    const revenue = (r.revenue_cents || 0) / 100;

    return {
      level: r.level,
      state: r.state || 'Total',
      county: r.county,
      zip: r.zip,
      contacted,
      replied,
      interested,
      contracts,
      responseRate: Math.round((replied / contacted) * 10000) / 100,
      interestRate: replied > 0 ? Math.round((interested / replied) * 10000) / 100 : 0,
      contractRate: interested > 0 ? Math.round((contracts / interested) * 10000) / 100 : 0,
      avgDealValue: (r.avg_deal_value || 0) / 100,
      totalRevenue: revenue,
      costPerLead: Math.round((totalCost / contacted) * 100) / 100,
      roi: totalCost > 0 ? Math.round(((revenue - totalCost) / totalCost) * 100) : 0,
      parentPath: r.level === 'county' ? r.state : r.level === 'zip' ? `${r.state}/${r.county}` : undefined,
    };
  };

  return {
    summary: summary ? processRow(summary) : null,
    states: states.map(processRow).sort((a, b) => b.contacted - a.contacted).slice(0, 10),
    topCounties: counties.map(processRow).sort((a, b) => b.responseRate - a.responseRate).slice(0, 15),
    topZips: zips.map(processRow).sort((a, b) => b.responseRate - a.responseRate).slice(0, 20),
    drillDownAvailable: counties.length > 0 || zips.length > 0,
  };
}

// --- Cross-Dimensional Time Pattern Analysis ---
function processCrossDimensionalTime(data: any[]): {
  patterns: CrossDimensionalPattern[];
  optimalSlots: { day: string; hour: number; responseRate: number }[];
  avoidSlots: { day: string; hour: number; responseRate: number }[];
  heatmapData: number[][];
  recommendation: string;
} {
  if (data.length === 0) {
    return {
      patterns: [],
      optimalSlots: [],
      avoidSlots: [],
      heatmapData: [],
      recommendation: 'Insufficient data for cross-dimensional time analysis.',
    };
  }

  const patterns: CrossDimensionalPattern[] = data.map((d: any) => {
    const sent = d.sent || 1;
    const replied = d.replied || 0;
    const responseRate = (replied / sent) * 100;

    return {
      dayOfWeek: d.day_of_week?.trim() || 'Unknown',
      hour: d.hour,
      sent,
      replied,
      responseRate: Math.round(responseRate * 100) / 100,
      qualityScore: Math.round(responseRate * 20), // 5% = 100 score
      isOptimal: false, // Will be set below
    };
  });

  // Find average response rate
  const avgRate = patterns.reduce((sum, p) => sum + p.responseRate, 0) / patterns.length;

  // Mark optimal slots (>50% above average)
  patterns.forEach(p => {
    p.isOptimal = p.responseRate > avgRate * 1.5 && p.sent >= 20;
  });

  // Sort to find best and worst
  const sorted = [...patterns].filter(p => p.sent >= 10).sort((a, b) => b.responseRate - a.responseRate);
  const optimalSlots = sorted.slice(0, 5).map(p => ({
    day: p.dayOfWeek,
    hour: p.hour,
    responseRate: p.responseRate,
  }));
  const avoidSlots = sorted.slice(-5).reverse().map(p => ({
    day: p.dayOfWeek,
    hour: p.hour,
    responseRate: p.responseRate,
  }));

  // Build heatmap data (7 days x 24 hours)
  const heatmapData: number[][] = Array(7).fill(null).map(() => Array(24).fill(0));
  patterns.forEach(p => {
    const dayIndex = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
      .findIndex(d => p.dayOfWeek.startsWith(d));
    if (dayIndex >= 0 && p.hour >= 0 && p.hour < 24) {
      heatmapData[dayIndex][p.hour] = p.responseRate;
    }
  });

  const bestSlot = optimalSlots[0];
  const worstSlot = avoidSlots[0];
  const recommendation = bestSlot && worstSlot
    ? `Best time: ${bestSlot.day.trim()} ${formatHourLabel(bestSlot.hour)} (${bestSlot.responseRate.toFixed(1)}% response rate). Avoid: ${worstSlot.day.trim()} ${formatHourLabel(worstSlot.hour)} (${worstSlot.responseRate.toFixed(1)}%). Shifting sends from worst to best slots could improve response by ${Math.round((bestSlot.responseRate / Math.max(worstSlot.responseRate, 0.1) - 1) * 100)}%.`
    : 'Continue sending to build cross-dimensional time data.';

  return { patterns, optimalSlots, avoidSlots, heatmapData, recommendation };
}

// --- Consent-to-Conversion Analysis ---
function processConsentConversion(data: any[]): {
  methods: ConsentConversionMetrics[];
  bestMethod: ConsentConversionMetrics | null;
  insight: string;
} {
  if (data.length === 0) {
    return {
      methods: [],
      bestMethod: null,
      insight: 'No consent conversion data available.',
    };
  }

  const totalLeads = data.reduce((sum, d) => sum + (d.total_leads || 0), 0);
  const totalContracted = data.reduce((sum, d) => sum + (d.contracted || 0), 0);
  const avgConversionRate = totalLeads > 0 ? totalContracted / totalLeads : 0;

  const methods: ConsentConversionMetrics[] = data.map((d: any) => {
    const leads = d.total_leads || 1;
    const contracted = d.contracted || 0;
    const conversionRate = contracted / leads;
    const comparedToAvg = avgConversionRate > 0 ? (conversionRate / avgConversionRate) : 1;

    // Determine legal strength of consent method
    let legalStrength: 'strong' | 'moderate' | 'weak' = 'moderate';
    const method = (d.consent_method || '').toLowerCase();
    if (method.includes('keyword') || method.includes('sms') || method.includes('double')) {
      legalStrength = 'strong'; // SMS keyword opt-in is strongest TCPA defense
    } else if (method.includes('web') || method.includes('form')) {
      legalStrength = 'moderate';
    } else if (method.includes('verbal') || method.includes('implied')) {
      legalStrength = 'weak';
    }

    return {
      consentMethod: d.consent_method || 'Unknown',
      totalLeads: leads,
      replied: d.replied || 0,
      interested: d.interested || 0,
      contracted,
      conversionRate: Math.round(conversionRate * 10000) / 100,
      comparedToAverage: Math.round(comparedToAvg * 100) / 100,
      legalStrength,
    };
  });

  // Sort by conversion rate
  const sorted = [...methods].sort((a, b) => b.conversionRate - a.conversionRate);
  const bestMethod = sorted[0] || null;

  const strongMethods = methods.filter(m => m.legalStrength === 'strong');
  const bestStrongMethod = strongMethods.sort((a, b) => b.conversionRate - a.conversionRate)[0];

  let insight = '';
  if (bestMethod && bestStrongMethod) {
    if (bestMethod.consentMethod === bestStrongMethod.consentMethod) {
      insight = `"${bestMethod.consentMethod}" has both the highest conversion rate (${bestMethod.conversionRate}%) AND strong legal protection. Focus acquisition on this consent method.`;
    } else {
      insight = `"${bestMethod.consentMethod}" converts best (${bestMethod.conversionRate}%) but "${bestStrongMethod.consentMethod}" offers stronger TCPA protection (${bestStrongMethod.conversionRate}% conversion). Consider the compliance-ROI tradeoff.`;
    }
  } else if (bestMethod) {
    insight = `"${bestMethod.consentMethod}" converts ${bestMethod.comparedToAverage}x better than average.`;
  }

  return { methods, bestMethod, insight };
}

// --- Visual Funnel Processing ---
function processVisualFunnel(data: any[]): {
  stages: FunnelStage[];
  totalDropOff: number;
  biggestBottleneck: { stage: string; dropOffPercent: number } | null;
  efficiency: number;
} {
  if (data.length === 0) {
    return {
      stages: [],
      totalDropOff: 0,
      biggestBottleneck: null,
      efficiency: 0,
    };
  }

  const sortedStages = [...data].sort((a: any, b: any) => a.stage_order - b.stage_order);
  const topOfFunnel = sortedStages[0]?.count || 1;
  const bottomOfFunnel = sortedStages[sortedStages.length - 1]?.count || 0;

  const stages: FunnelStage[] = sortedStages.map((s: any, index: number) => {
    const count = s.count || 0;
    const nextCount = sortedStages[index + 1]?.count || 0;
    const dropOffCount = count - nextCount;
    const dropOffPercent = count > 0 ? (dropOffCount / count) * 100 : 0;
    const conversionToNext = count > 0 && index < sortedStages.length - 1 ? (nextCount / count) * 100 : 100;
    const cumulativeConversion = topOfFunnel > 0 ? (count / topOfFunnel) * 100 : 0;

    return {
      stage: s.stage,
      count,
      dropOffCount: index < sortedStages.length - 1 ? dropOffCount : 0,
      dropOffPercent: index < sortedStages.length - 1 ? Math.round(dropOffPercent * 10) / 10 : 0,
      conversionToNext: Math.round(conversionToNext * 10) / 10,
      cumulativeConversion: Math.round(cumulativeConversion * 10) / 10,
      widthPercent: cumulativeConversion,
    };
  });

  // Find biggest bottleneck (stage with highest drop-off %)
  const bottleneckStages = stages.filter(s => s.dropOffPercent > 0);
  const biggestBottleneck = bottleneckStages.length > 0
    ? bottleneckStages.reduce((max, s) => s.dropOffPercent > max.dropOffPercent ? s : max)
    : null;

  const totalDropOff = topOfFunnel > 0 ? Math.round((1 - bottomOfFunnel / topOfFunnel) * 1000) / 10 : 100;
  const efficiency = topOfFunnel > 0 ? Math.round((bottomOfFunnel / topOfFunnel) * 1000) / 10 : 0;

  return {
    stages,
    totalDropOff,
    biggestBottleneck: biggestBottleneck ? { stage: biggestBottleneck.stage, dropOffPercent: biggestBottleneck.dropOffPercent } : null,
    efficiency,
  };
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

// --- Calculate Data Confidence Level ---
function calculateDataConfidence(sampleSize: number, minNeeded: number = 100): 'high' | 'medium' | 'low' | 'insufficient' {
  if (sampleSize < minNeeded * 0.5) return 'insufficient';
  if (sampleSize < minNeeded) return 'low';
  if (sampleSize < minNeeded * 3) return 'medium';
  return 'high';
}

// --- Calculate ROI Projection ---
function calculateROIProjection(
  currentMetric: number,
  targetMetric: number,
  totalContacted: number,
  avgDealValue: number,
  conversionToContract: number // e.g., 0.05 for 5% reply-to-contract
): ROIProjection {
  const currentReplies = Math.round(currentMetric * totalContacted / 100);
  const projectedReplies = Math.round(targetMetric * totalContacted / 100);
  const additionalReplies = projectedReplies - currentReplies;
  const additionalDeals = Math.round(additionalReplies * conversionToContract);
  const revenueImpact = additionalDeals * avgDealValue;

  // Calculate confidence range (roughly +/- 30% for medium confidence)
  const variance = 0.3;

  return {
    metric: 'Response Rate Improvement',
    currentValue: currentMetric,
    projectedValue: targetMetric,
    projectedAdditionalReplies: additionalReplies,
    projectedAdditionalDeals: additionalDeals,
    projectedRevenueImpact: revenueImpact,
    confidenceRange: {
      low: Math.round(revenueImpact * (1 - variance)),
      high: Math.round(revenueImpact * (1 + variance)),
    },
  };
}

// --- Enhanced Insights Generator with ROI and Confidence ---
function generateEnhancedInsights(data: {
  overall: any;
  regional: RegionalMetrics[];
  daily: any[];
  sources: any[];
  timing: any;
  hourly?: HourlyMetrics[];
  sourceROI?: SourceROI[];
  abTests?: ABTestResult[];
  crossDimensional?: { patterns: CrossDimensionalPattern[]; optimalSlots: any[] };
  consentMetrics?: { methods: ConsentConversionMetrics[]; bestMethod: ConsentConversionMetrics | null };
  systemPrior?: { totalSent: number; totalReplied: number; avgResponseRate: number; avgDealValue: number };
}): CampaignInsight[] {
  const insights: CampaignInsight[] = [];
  const { overall, regional, daily, sources, timing, hourly, sourceROI, abTests, crossDimensional, consentMetrics, systemPrior } = data;

  const totalContacted = overall.total_contacted || 1;
  const totalReplied = overall.total_replied || 0;
  const totalInterested = overall.total_interested || 0;
  const responseRate = (totalReplied / totalContacted) * 100;
  const interestRate = totalReplied > 0 ? (totalInterested / totalReplied) * 100 : 0;
  const avgDealValue = systemPrior?.avgDealValue || 10000;
  const replyToContractRate = 0.05; // 5% of replies become contracts (typical)

  // 1. Response Rate Analysis with ROI Projection
  if (responseRate < 1.5) {
    const targetRate = 2.5;
    const roiProjection = calculateROIProjection(responseRate, targetRate, totalContacted, avgDealValue, replyToContractRate);

    insights.push({
      category: 'warning',
      priority: 'critical',
      title: 'Low Response Rate',
      description: 'Your response rate is below industry benchmark for motivated sellers.',
      metric: 'Response Rate',
      currentValue: responseRate.toFixed(2) + '%',
      benchmark: '2.5%',
      recommendation: 'Consider: (1) Improve subject lines with urgency/personalization, (2) Switch to higher-quality lead sources like tax delinquent or probate, (3) Add SMS channel for 90%+ open rates, (4) Test different send times (Tue-Thu 10am-2pm perform best).',
      potentialImpact: `Improving to ${targetRate}% could add ${roiProjection.projectedAdditionalReplies} more replies, ${roiProjection.projectedAdditionalDeals} deals, $${roiProjection.projectedRevenueImpact.toLocaleString()} revenue`,
      roiProjection,
      confidence: calculateDataConfidence(totalContacted, 100),
      sampleSize: totalContacted,
      dataCitations: [
        `Current: ${totalReplied} replies from ${totalContacted} contacts (${responseRate.toFixed(2)}%)`,
        `Industry benchmark: 2.5% for motivated seller campaigns`,
        `Avg deal value used: $${avgDealValue.toLocaleString()}`,
      ],
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
      confidence: calculateDataConfidence(totalContacted, 100),
      sampleSize: totalContacted,
      dataCitations: [
        `${totalReplied} replies from ${totalContacted} contacts`,
        `${(responseRate - 2.5).toFixed(1)}% above industry benchmark`,
      ],
    });
  }

  // 2. Cross-Dimensional Time Optimization (NEW)
  if (crossDimensional && crossDimensional.optimalSlots.length > 0) {
    const best = crossDimensional.optimalSlots[0];
    const patterns = crossDimensional.patterns.filter(p => p.sent >= 20);

    if (patterns.length >= 5) {
      const avgRate = patterns.reduce((sum, p) => sum + p.responseRate, 0) / patterns.length;
      const improvement = best.responseRate > avgRate ? ((best.responseRate / avgRate - 1) * 100) : 0;
      const projectedAdditionalReplies = Math.round(totalContacted * 0.3 * (best.responseRate - avgRate) / 100);

      insights.push({
        category: 'opportunity',
        priority: 'high',
        title: 'Optimal Send Time Identified',
        description: `${best.day.trim()} at ${formatHourLabel(best.hour)} shows ${improvement.toFixed(0)}% better response than average.`,
        metric: 'Time Optimization',
        currentValue: `Best: ${best.day.trim()} ${formatHourLabel(best.hour)} (${best.responseRate.toFixed(2)}%)`,
        benchmark: `Average: ${avgRate.toFixed(2)}%`,
        recommendation: `ACTION: Set Campaign > Scheduling > Send Window to ${best.day.trim()} ${formatHourLabel(best.hour)} - ${formatHourLabel(best.hour + 2)}. This requires no message changes - just timing.`,
        potentialImpact: `Shifting 30% of volume to optimal time could add ${projectedAdditionalReplies} replies`,
        roiProjection: {
          metric: 'Time Optimization',
          currentValue: avgRate,
          projectedValue: best.responseRate,
          projectedAdditionalReplies,
          projectedAdditionalDeals: Math.round(projectedAdditionalReplies * replyToContractRate),
          projectedRevenueImpact: Math.round(projectedAdditionalReplies * replyToContractRate * avgDealValue),
          confidenceRange: {
            low: Math.round(projectedAdditionalReplies * replyToContractRate * avgDealValue * 0.7),
            high: Math.round(projectedAdditionalReplies * replyToContractRate * avgDealValue * 1.3),
          },
        },
        confidence: calculateDataConfidence(patterns.reduce((sum, p) => sum + p.sent, 0), 500),
        sampleSize: patterns.reduce((sum, p) => sum + p.sent, 0),
        dataCitations: [
          `Best slot: ${best.day.trim()} ${formatHourLabel(best.hour)} - ${best.responseRate.toFixed(2)}% response`,
          `Based on ${patterns.length} time slots with 20+ sends each`,
          `Total samples: ${patterns.reduce((sum, p) => sum + p.sent, 0)} sends`,
        ],
      });
    }
  }

  // 3. Source ROI with Dollar Projections (ENHANCED)
  if (sourceROI && sourceROI.length >= 2) {
    const profitable = sourceROI.filter(s => s.roi > 100 && s.contacted >= 20);
    const unprofitable = sourceROI.filter(s => s.roi < 0 && s.contacted >= 30);

    if (profitable.length > 0 && unprofitable.length > 0) {
      const topSource = profitable[0];
      const worstSource = unprofitable[unprofitable.length - 1];
      const revenuePerContact = topSource.contacted > 0 ? topSource.revenue / topSource.contacted : 0;
      const projectedRevenue = Math.round(worstSource.contacted * revenuePerContact);

      insights.push({
        category: 'improvement',
        priority: 'critical',
        title: 'Reallocate Budget by Source ROI',
        description: `"${topSource.source}" has ${topSource.roi.toFixed(0)}% ROI while "${worstSource.source}" is losing money (${worstSource.roi.toFixed(0)}% ROI).`,
        metric: 'Source ROI Gap',
        currentValue: `${topSource.source}: ${topSource.roi.toFixed(0)}% ROI`,
        benchmark: `${worstSource.source}: ${worstSource.roi.toFixed(0)}% ROI`,
        recommendation: `ACTION: (1) Pause lead imports from "${worstSource.source}" immediately - you've lost $${Math.abs(worstSource.profit).toFixed(2)} on ${worstSource.contacted} contacts. (2) Double down on "${topSource.source}" - increase daily cap by 50%.`,
        potentialImpact: `Reallocating ${worstSource.contacted} wasted contacts to ${topSource.source} could generate $${projectedRevenue.toLocaleString()} additional revenue`,
        roiProjection: {
          metric: 'Source Reallocation',
          currentValue: worstSource.roi,
          projectedValue: topSource.roi,
          projectedAdditionalReplies: Math.round(worstSource.contacted * (topSource.replied / topSource.contacted - worstSource.replied / worstSource.contacted)),
          projectedAdditionalDeals: Math.round(worstSource.contacted * revenuePerContact / avgDealValue),
          projectedRevenueImpact: projectedRevenue,
          confidenceRange: {
            low: Math.round(projectedRevenue * 0.6),
            high: Math.round(projectedRevenue * 1.4),
          },
        },
        confidence: calculateDataConfidence(Math.min(topSource.contacted, worstSource.contacted), 50),
        sampleSize: topSource.contacted + worstSource.contacted,
        dataCitations: [
          `${topSource.source}: ${topSource.contacted} contacts, ${topSource.replied} replies, $${topSource.revenue.toFixed(0)} revenue`,
          `${worstSource.source}: ${worstSource.contacted} contacts, ${worstSource.replied} replies, $${Math.abs(worstSource.profit).toFixed(0)} loss`,
          `Revenue per contact for top source: $${revenuePerContact.toFixed(2)}`,
        ],
      });
    }
  }

  // 4. Consent Method Optimization (NEW)
  if (consentMetrics && consentMetrics.methods.length >= 2 && consentMetrics.bestMethod) {
    const best = consentMetrics.bestMethod;
    const avgConversion = consentMetrics.methods.reduce((sum, m) => sum + m.conversionRate, 0) / consentMetrics.methods.length;

    if (best.comparedToAverage > 1.5) {
      insights.push({
        category: 'opportunity',
        priority: 'medium',
        title: 'High-Converting Consent Method',
        description: `"${best.consentMethod}" converts ${best.comparedToAverage.toFixed(1)}x better than average with ${best.legalStrength} legal protection.`,
        metric: 'Consent-to-Conversion',
        currentValue: `${best.consentMethod}: ${best.conversionRate.toFixed(1)}%`,
        benchmark: `Average: ${avgConversion.toFixed(1)}%`,
        recommendation: best.legalStrength === 'strong'
          ? `FOCUS: "${best.consentMethod}" provides both best conversion AND strongest TCPA defense. Prioritize this consent pathway in all acquisition channels.`
          : `NOTE: "${best.consentMethod}" converts best but has ${best.legalStrength} legal protection. Consider shifting to SMS keyword consent for better compliance.`,
        potentialImpact: `Shifting leads to ${best.consentMethod} could improve conversion by ${((best.comparedToAverage - 1) * 100).toFixed(0)}%`,
        confidence: calculateDataConfidence(best.totalLeads, 30),
        sampleSize: best.totalLeads,
        dataCitations: [
          `${best.consentMethod}: ${best.totalLeads} leads, ${best.contracted} contracts (${best.conversionRate.toFixed(1)}%)`,
          `Legal strength: ${best.legalStrength}`,
          `Compared to average conversion: ${best.comparedToAverage.toFixed(1)}x`,
        ],
      });
    }
  }

  // 5. A/B Test with Bandit Recommendation (ENHANCED)
  if (abTests && abTests.length > 0) {
    const winners = abTests.filter(t => t.isWinner);

    if (winners.length > 0) {
      const topWinner = winners.reduce((a, b) => (b.improvement || 0) > (a.improvement || 0) ? b : a);
      const additionalReplies = Math.round(totalContacted * (topWinner.improvement || 0) / 100);
      const revenueImpact = Math.round(additionalReplies * replyToContractRate * avgDealValue);

      insights.push({
        category: 'opportunity',
        priority: 'critical',
        title: 'A/B Test Winner Ready to Scale',
        description: `"${topWinner.testName}" variant "${topWinner.variant}" outperforms control by ${topWinner.improvement?.toFixed(1)}% with ${topWinner.confidence}% confidence.`,
        metric: 'Statistical Significance',
        currentValue: `+${topWinner.improvement?.toFixed(1)}% (${topWinner.confidence}% confidence)`,
        benchmark: '95% confidence threshold met',
        recommendation: `ACTION: Set "${topWinner.variant}" as default template immediately. Archive control variant. Start new test with winner as baseline.`,
        potentialImpact: `Scaling to all sends: +${additionalReplies} replies, $${revenueImpact.toLocaleString()} revenue`,
        roiProjection: {
          metric: 'A/B Test Scale',
          currentValue: topWinner.responseRate - (topWinner.improvement || 0),
          projectedValue: topWinner.responseRate,
          projectedAdditionalReplies: additionalReplies,
          projectedAdditionalDeals: Math.round(additionalReplies * replyToContractRate),
          projectedRevenueImpact: revenueImpact,
          confidenceRange: {
            low: Math.round(revenueImpact * 0.7),
            high: Math.round(revenueImpact * 1.3),
          },
        },
        confidence: topWinner.confidence >= 95 ? 'high' : topWinner.confidence >= 80 ? 'medium' : 'low',
        sampleSize: topWinner.sent,
        dataCitations: [
          `Test: ${topWinner.testName}`,
          `Winner: ${topWinner.variant} - ${topWinner.sent} sends, ${topWinner.replied} replies`,
          `Improvement: +${topWinner.improvement?.toFixed(1)}% response rate`,
          `Statistical confidence: ${topWinner.confidence}%`,
        ],
      });
    } else {
      // Check if tests need more data
      const largestTest = abTests.reduce((a, b) => b.sent > a.sent ? b : a);
      const minSampleSize = calculateMinimumSampleSize([{ expectedValue: largestTest.responseRate / 100, sent: largestTest.sent }]);

      if (largestTest.sent < minSampleSize) {
        insights.push({
          category: 'improvement',
          priority: 'low',
          title: 'A/B Test Needs More Data',
          description: `Active tests running but insufficient sample size for conclusions.`,
          metric: 'Sample Size',
          currentValue: `${largestTest.sent} sends`,
          benchmark: `${minSampleSize} needed for 95% confidence`,
          recommendation: `Continue running tests. Need ${minSampleSize - largestTest.sent} more sends for reliable results. Do NOT change test parameters mid-flight.`,
          potentialImpact: 'Premature test conclusions waste opportunity',
          confidence: 'insufficient',
          sampleSize: largestTest.sent,
          dataCitations: [
            `Largest test: ${largestTest.testName} with ${largestTest.sent} sends`,
            `Minimum needed: ${minSampleSize} sends per variant`,
            `Current confidence: ${largestTest.confidence}%`,
          ],
        });
      }
    }
  }

  // Include remaining insights from original function (simplified)
  // 6. Interest Conversion
  if (interestRate < 12 && totalReplied >= 20) {
    insights.push({
      category: 'improvement',
      priority: 'high',
      title: 'Low Reply-to-Interest Conversion',
      description: 'Many leads who reply are not converting to interested status.',
      metric: 'Interest Rate',
      currentValue: interestRate.toFixed(2) + '%',
      benchmark: '15-20%',
      recommendation: 'Review AI reply handling: (1) Ensure counter-offers are being extracted, (2) Speed up response time to under 5 minutes.',
      potentialImpact: `Improving to 15% could add ${Math.round(totalReplied * 0.03)} more interested leads`,
      confidence: calculateDataConfidence(totalReplied, 50),
      sampleSize: totalReplied,
      dataCitations: [
        `${totalInterested} interested from ${totalReplied} replies (${interestRate.toFixed(1)}%)`,
      ],
    });
  }

  // 7. Regional Performance Gaps
  const topRegion = regional[0];
  const underperformingRegions = regional.filter(r =>
    r.contacted > 50 && r.responseRate < (topRegion?.responseRate || 0) * 0.5
  );

  if (underperformingRegions.length > 0 && topRegion) {
    insights.push({
      category: 'opportunity',
      priority: 'medium',
      title: 'Regional Performance Gap',
      description: `${underperformingRegions.length} region(s) underperforming vs top market.`,
      metric: 'Regional Variance',
      currentValue: underperformingRegions.map(r => r.state).join(', '),
      benchmark: `Top: ${topRegion.state} at ${topRegion.responseRate.toFixed(1)}%`,
      recommendation: `Consider regional message customization for ${underperformingRegions[0]?.state}. Check compliance rules.`,
      potentialImpact: 'Closing gap could increase overall response by 20-30%',
      confidence: calculateDataConfidence(underperformingRegions.reduce((sum, r) => sum + r.contacted, 0), 100),
      sampleSize: underperformingRegions.reduce((sum, r) => sum + r.contacted, 0),
      dataCitations: underperformingRegions.slice(0, 3).map(r =>
        `${r.state}: ${r.contacted} contacts, ${r.responseRate.toFixed(1)}% response`
      ),
    });
  }

  // Sort by priority and limit based on data quality
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  insights.sort((a, b) => {
    // First sort by priority
    const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (priorityDiff !== 0) return priorityDiff;
    // Then by confidence (higher confidence first)
    const confOrder = { high: 0, medium: 1, low: 2, insufficient: 3 };
    return (confOrder[a.confidence || 'medium'] || 1) - (confOrder[b.confidence || 'medium'] || 1);
  });

  // Limit to recommendations we have confidence in
  const sufficientDataInsights = insights.filter(i =>
    i.confidence !== 'insufficient' || i.priority === 'critical'
  );

  // Return up to 8 insights, preferring those with sufficient data
  return sufficientDataInsights.slice(0, 8);
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
