/**
 * CRM Analytics Engine
 *
 * Comprehensive analytics for:
 * - Regional breakdowns (state, county, city, zip)
 * - Outreach method performance (email, SMS, social media)
 * - Channel attribution
 * - Conversion funnels by segment
 */

import sql from '@/app/api/utils/sql';

export interface RegionalAnalytics {
  state: string;
  county?: string;
  city?: string;
  zipCode?: string;
  totalLeads: number;
  activeLeads: number;
  contactedLeads: number;
  respondedLeads: number;
  contractsGenerated: number;
  dealsClosed: number;
  totalRevenue: number;
  avgDealSize: number;
  responseRate: number;
  conversionRate: number;
}

export interface OutreachMethodAnalytics {
  method: 'email' | 'sms' | 'instagram' | 'facebook' | 'tiktok' | 'twitter' | 'direct_mail' | 'phone';
  messagesSent: number;
  messagesDelivered: number;
  messagesOpened: number;
  responses: number;
  conversions: number;
  optOuts: number;
  bounces: number;
  deliveryRate: number;
  openRate: number;
  responseRate: number;
  conversionRate: number;
  costPerMessage: number;
  costPerConversion: number;
  roi: number;
}

export interface ChannelAttribution {
  channel: string;
  firstTouch: number;
  lastTouch: number;
  assistedConversions: number;
  directConversions: number;
  totalRevenue: number;
  avgTouchesBeforeConversion: number;
}

export interface FunnelStage {
  stage: string;
  count: number;
  conversionRate: number;
  avgTimeInStageHours: number;
  dropOffRate: number;
}

export interface DateRange {
  start: Date;
  end: Date;
}

/**
 * Get regional analytics
 */
export async function getRegionalAnalytics(
  organizationId: string,
  groupBy: 'state' | 'county' | 'city' | 'zipCode' = 'state',
  dateRange?: DateRange
): Promise<RegionalAnalytics[]> {
  const startDate = dateRange?.start.toISOString() || '1970-01-01';
  const endDate = dateRange?.end.toISOString() || '2099-12-31';

  // Use explicit queries for each groupBy type to avoid sql.unsafe
  let results: Array<Record<string, unknown>> = [];

  if (groupBy === 'state') {
    results = await sql`
      SELECT
        l.state as region,
        COUNT(DISTINCT l.id)::int as total_leads,
        COUNT(DISTINCT l.id) FILTER (WHERE l.status NOT IN ('lost', 'closed'))::int as active_leads,
        COUNT(DISTINCT l.id) FILTER (WHERE l.status IN ('contacted', 'engaged', 'negotiating', 'contracted', 'closed'))::int as contacted_leads,
        COUNT(DISTINCT l.id) FILTER (WHERE l.status IN ('engaged', 'negotiating', 'contracted', 'closed'))::int as responded_leads,
        COUNT(DISTINCT c.id)::int as contracts_generated,
        COUNT(DISTINCT l.id) FILTER (WHERE l.status = 'closed')::int as deals_closed,
        COALESCE(SUM(c.assignment_fee_cents) FILTER (WHERE c.status = 'closed'), 0)::bigint / 100 as total_revenue,
        COALESCE(AVG(c.assignment_fee_cents) FILTER (WHERE c.status = 'closed'), 0)::bigint / 100 as avg_deal_size
      FROM leads l
      LEFT JOIN contracts c ON c.lead_id = l.id
      WHERE l.organization_id = ${organizationId}
        AND l.created_at BETWEEN ${startDate}::timestamptz AND ${endDate}::timestamptz
        AND l.state IS NOT NULL
      GROUP BY l.state
      ORDER BY COUNT(DISTINCT l.id) DESC
      LIMIT 100
    `;
  } else if (groupBy === 'county') {
    results = await sql`
      SELECT
        l.county as region,
        COUNT(DISTINCT l.id)::int as total_leads,
        COUNT(DISTINCT l.id) FILTER (WHERE l.status NOT IN ('lost', 'closed'))::int as active_leads,
        COUNT(DISTINCT l.id) FILTER (WHERE l.status IN ('contacted', 'engaged', 'negotiating', 'contracted', 'closed'))::int as contacted_leads,
        COUNT(DISTINCT l.id) FILTER (WHERE l.status IN ('engaged', 'negotiating', 'contracted', 'closed'))::int as responded_leads,
        COUNT(DISTINCT c.id)::int as contracts_generated,
        COUNT(DISTINCT l.id) FILTER (WHERE l.status = 'closed')::int as deals_closed,
        COALESCE(SUM(c.assignment_fee_cents) FILTER (WHERE c.status = 'closed'), 0)::bigint / 100 as total_revenue,
        COALESCE(AVG(c.assignment_fee_cents) FILTER (WHERE c.status = 'closed'), 0)::bigint / 100 as avg_deal_size
      FROM leads l
      LEFT JOIN contracts c ON c.lead_id = l.id
      WHERE l.organization_id = ${organizationId}
        AND l.created_at BETWEEN ${startDate}::timestamptz AND ${endDate}::timestamptz
        AND l.county IS NOT NULL
      GROUP BY l.county
      ORDER BY COUNT(DISTINCT l.id) DESC
      LIMIT 100
    `;
  } else if (groupBy === 'city') {
    results = await sql`
      SELECT
        l.city as region,
        COUNT(DISTINCT l.id)::int as total_leads,
        COUNT(DISTINCT l.id) FILTER (WHERE l.status NOT IN ('lost', 'closed'))::int as active_leads,
        COUNT(DISTINCT l.id) FILTER (WHERE l.status IN ('contacted', 'engaged', 'negotiating', 'contracted', 'closed'))::int as contacted_leads,
        COUNT(DISTINCT l.id) FILTER (WHERE l.status IN ('engaged', 'negotiating', 'contracted', 'closed'))::int as responded_leads,
        COUNT(DISTINCT c.id)::int as contracts_generated,
        COUNT(DISTINCT l.id) FILTER (WHERE l.status = 'closed')::int as deals_closed,
        COALESCE(SUM(c.assignment_fee_cents) FILTER (WHERE c.status = 'closed'), 0)::bigint / 100 as total_revenue,
        COALESCE(AVG(c.assignment_fee_cents) FILTER (WHERE c.status = 'closed'), 0)::bigint / 100 as avg_deal_size
      FROM leads l
      LEFT JOIN contracts c ON c.lead_id = l.id
      WHERE l.organization_id = ${organizationId}
        AND l.created_at BETWEEN ${startDate}::timestamptz AND ${endDate}::timestamptz
        AND l.city IS NOT NULL
      GROUP BY l.city
      ORDER BY COUNT(DISTINCT l.id) DESC
      LIMIT 100
    `;
  } else {
    results = await sql`
      SELECT
        l.zip_code as region,
        COUNT(DISTINCT l.id)::int as total_leads,
        COUNT(DISTINCT l.id) FILTER (WHERE l.status NOT IN ('lost', 'closed'))::int as active_leads,
        COUNT(DISTINCT l.id) FILTER (WHERE l.status IN ('contacted', 'engaged', 'negotiating', 'contracted', 'closed'))::int as contacted_leads,
        COUNT(DISTINCT l.id) FILTER (WHERE l.status IN ('engaged', 'negotiating', 'contracted', 'closed'))::int as responded_leads,
        COUNT(DISTINCT c.id)::int as contracts_generated,
        COUNT(DISTINCT l.id) FILTER (WHERE l.status = 'closed')::int as deals_closed,
        COALESCE(SUM(c.assignment_fee_cents) FILTER (WHERE c.status = 'closed'), 0)::bigint / 100 as total_revenue,
        COALESCE(AVG(c.assignment_fee_cents) FILTER (WHERE c.status = 'closed'), 0)::bigint / 100 as avg_deal_size
      FROM leads l
      LEFT JOIN contracts c ON c.lead_id = l.id
      WHERE l.organization_id = ${organizationId}
        AND l.created_at BETWEEN ${startDate}::timestamptz AND ${endDate}::timestamptz
        AND l.zip_code IS NOT NULL
      GROUP BY l.zip_code
      ORDER BY COUNT(DISTINCT l.id) DESC
      LIMIT 100
    `;
  }

  return results.map(r => {
    const totalLeads = Number(r.total_leads) || 0;
    const contactedLeads = Number(r.contacted_leads) || 0;
    const respondedLeads = Number(r.responded_leads) || 0;
    const dealsClosed = Number(r.deals_closed) || 0;

    return {
      state: groupBy === 'state' ? String(r.region || '') : '',
      county: groupBy === 'county' ? String(r.region || '') : undefined,
      city: groupBy === 'city' ? String(r.region || '') : undefined,
      zipCode: groupBy === 'zipCode' ? String(r.region || '') : undefined,
      totalLeads,
      activeLeads: Number(r.active_leads) || 0,
      contactedLeads,
      respondedLeads,
      contractsGenerated: Number(r.contracts_generated) || 0,
      dealsClosed,
      totalRevenue: Number(r.total_revenue) || 0,
      avgDealSize: Number(r.avg_deal_size) || 0,
      responseRate: contactedLeads > 0 ? Math.round((respondedLeads / contactedLeads) * 10000) / 100 : 0,
      conversionRate: totalLeads > 0 ? Math.round((dealsClosed / totalLeads) * 10000) / 100 : 0,
    };
  });
}

/**
 * Get outreach method analytics
 */
export async function getOutreachMethodAnalytics(
  organizationId: string,
  dateRange?: DateRange
): Promise<OutreachMethodAnalytics[]> {
  const dateFilter = dateRange
    ? sql`AND created_at BETWEEN ${dateRange.start.toISOString()} AND ${dateRange.end.toISOString()}`
    : sql``;

  // Email analytics
  const emailStats = await sql`
    SELECT
      'email' as method,
      COUNT(*) FILTER (WHERE direction = 'outbound') as sent,
      COUNT(*) FILTER (WHERE direction = 'outbound' AND status = 'delivered') as delivered,
      COUNT(*) FILTER (WHERE direction = 'outbound' AND opened_at IS NOT NULL) as opened,
      COUNT(*) FILTER (WHERE direction = 'inbound') as responses,
      COUNT(*) FILTER (WHERE status = 'bounced') as bounces
    FROM message_events
    WHERE organization_id = ${organizationId}
      AND channel = 'email'
      ${dateFilter}
  `;

  // SMS analytics
  const smsStats = await sql`
    SELECT
      'sms' as method,
      COUNT(*) FILTER (WHERE direction = 'outbound') as sent,
      COUNT(*) FILTER (WHERE direction = 'outbound' AND status = 'sent') as delivered,
      0 as opened,
      COUNT(*) FILTER (WHERE direction = 'inbound') as responses,
      COUNT(*) FILTER (WHERE status = 'failed') as bounces
    FROM message_events
    WHERE organization_id = ${organizationId}
      AND channel = 'sms'
      ${dateFilter}
  `;

  // Social media analytics (per platform)
  const socialStats = await sql`
    SELECT
      platform as method,
      COUNT(*) FILTER (WHERE direction = 'outbound') as sent,
      COUNT(*) FILTER (WHERE direction = 'outbound' AND delivered_at IS NOT NULL) as delivered,
      COUNT(*) FILTER (WHERE direction = 'outbound' AND read_at IS NOT NULL) as opened,
      COUNT(*) FILTER (WHERE direction = 'inbound') as responses,
      0 as bounces
    FROM social_messages
    WHERE organization_id = ${organizationId}
      ${dateFilter}
    GROUP BY platform
  `.catch(() => []);

  // Conversion tracking
  const conversions = await sql`
    SELECT
      COALESCE(source, 'unknown') as method,
      COUNT(*) as conversions
    FROM leads
    WHERE organization_id = ${organizationId}
      AND status IN ('contracted', 'closed')
      ${dateFilter}
    GROUP BY source
  `;

  // Opt-outs
  const optOuts = await sql`
    SELECT
      channel as method,
      COUNT(*) as opt_outs
    FROM opt_outs
    WHERE organization_id = ${organizationId}
      ${dateFilter}
    GROUP BY channel
  `.catch(() => []);

  // Combine results
  const methods: OutreachMethodAnalytics['method'][] = ['email', 'sms', 'instagram', 'facebook', 'tiktok', 'twitter'];
  const results: OutreachMethodAnalytics[] = [];

  // Cost estimates per message type
  const costs: Record<string, number> = {
    email: 0.0001, // SES cost ~$0.10/1000
    sms: 0.00645, // SNS cost
    instagram: 0,
    facebook: 0,
    tiktok: 0,
    twitter: 0,
  };

  for (const method of methods) {
    let stats: Record<string, unknown> = { sent: 0, delivered: 0, opened: 0, responses: 0, bounces: 0 };

    if (method === 'email') {
      stats = emailStats[0] || stats;
    } else if (method === 'sms') {
      stats = smsStats[0] || stats;
    } else {
      const social = socialStats.find((s) => s.method === method);
      if (social) {
        stats = social;
      }
    }

    const conversionRow = conversions.find((c) =>
      c.method === method || (c.method === 'social_media' && ['instagram', 'facebook', 'tiktok', 'twitter'].includes(method))
    );
    const methodConversions = Number(conversionRow?.conversions) || 0;

    const optOutRow = optOuts.find((o) => o.method === method);
    const methodOptOuts = Number(optOutRow?.opt_outs) || 0;

    const sent = Number(stats.sent) || 0;
    const delivered = Number(stats.delivered) || 0;
    const opened = Number(stats.opened) || 0;
    const responses = Number(stats.responses) || 0;
    const bounces = Number(stats.bounces) || 0;

    const deliveryRate = sent > 0 ? (delivered / sent) * 100 : 0;
    const openRate = delivered > 0 ? (opened / delivered) * 100 : 0;
    const responseRate = delivered > 0 ? (responses / delivered) * 100 : 0;
    const conversionRate = responses > 0 ? (methodConversions / responses) * 100 : 0;

    const costPerMessage = costs[method] || 0;
    const totalCost = sent * costPerMessage;
    const costPerConversion = methodConversions > 0 ? totalCost / methodConversions : 0;

    // Assume average deal value of $10k for ROI calculation
    const avgDealValue = 10000;
    const revenue = methodConversions * avgDealValue;
    const roi = totalCost > 0 ? ((revenue - totalCost) / totalCost) * 100 : 0;

    results.push({
      method,
      messagesSent: sent,
      messagesDelivered: delivered,
      messagesOpened: opened,
      responses,
      conversions: methodConversions,
      optOuts: methodOptOuts,
      bounces,
      deliveryRate: Math.round(deliveryRate * 100) / 100,
      openRate: Math.round(openRate * 100) / 100,
      responseRate: Math.round(responseRate * 100) / 100,
      conversionRate: Math.round(conversionRate * 100) / 100,
      costPerMessage: Math.round(costPerMessage * 10000) / 10000,
      costPerConversion: Math.round(costPerConversion * 100) / 100,
      roi: Math.round(roi * 100) / 100,
    });
  }

  return results;
}

/**
 * Get channel attribution
 */
export async function getChannelAttribution(
  organizationId: string,
  dateRange?: DateRange
): Promise<ChannelAttribution[]> {
  const dateFilter = dateRange
    ? sql`AND l.created_at BETWEEN ${dateRange.start.toISOString()} AND ${dateRange.end.toISOString()}`
    : sql``;

  const results = await sql`
    WITH touch_points AS (
      SELECT
        l.id as lead_id,
        l.source as channel,
        l.status,
        c.assignment_fee_cents,
        ROW_NUMBER() OVER (PARTITION BY l.id ORDER BY l.created_at) as touch_order,
        COUNT(*) OVER (PARTITION BY l.id) as total_touches
      FROM leads l
      LEFT JOIN contracts c ON c.lead_id = l.id AND c.status = 'closed'
      WHERE l.organization_id = ${organizationId}
        ${dateFilter}
    )
    SELECT
      channel,
      COUNT(*) FILTER (WHERE touch_order = 1) as first_touch,
      COUNT(*) FILTER (WHERE touch_order = total_touches AND status IN ('contracted', 'closed')) as last_touch,
      COUNT(*) FILTER (WHERE touch_order > 1 AND touch_order < total_touches AND status IN ('contracted', 'closed')) as assisted,
      COUNT(*) FILTER (WHERE total_touches = 1 AND status IN ('contracted', 'closed')) as direct,
      COALESCE(SUM(assignment_fee_cents) FILTER (WHERE status = 'closed'), 0)::bigint / 100 as revenue,
      COALESCE(AVG(total_touches) FILTER (WHERE status IN ('contracted', 'closed')), 0) as avg_touches
    FROM touch_points
    WHERE channel IS NOT NULL
    GROUP BY channel
    ORDER BY first_touch DESC
  `;

  return results.map(r => ({
    channel: r.channel,
    firstTouch: r.first_touch,
    lastTouch: r.last_touch,
    assistedConversions: r.assisted,
    directConversions: r.direct,
    totalRevenue: r.revenue,
    avgTouchesBeforeConversion: Math.round(r.avg_touches * 10) / 10,
  }));
}

/**
 * Get conversion funnel
 */
export async function getConversionFunnel(
  organizationId: string,
  dateRange?: DateRange
): Promise<FunnelStage[]> {
  const dateFilter = dateRange
    ? sql`AND created_at BETWEEN ${dateRange.start.toISOString()} AND ${dateRange.end.toISOString()}`
    : sql``;

  const stages = await sql`
    WITH stage_counts AS (
      SELECT
        status,
        COUNT(*) as count,
        AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 3600) as avg_hours
      FROM leads
      WHERE organization_id = ${organizationId}
        ${dateFilter}
      GROUP BY status
    ),
    totals AS (
      SELECT COUNT(*) as total FROM leads
      WHERE organization_id = ${organizationId}
        ${dateFilter}
    )
    SELECT
      sc.status,
      sc.count,
      ROUND((sc.count::numeric / NULLIF(t.total, 0)) * 100, 2) as pct,
      ROUND(sc.avg_hours::numeric, 1) as avg_hours
    FROM stage_counts sc, totals t
    ORDER BY
      CASE sc.status
        WHEN 'new' THEN 1
        WHEN 'contacted' THEN 2
        WHEN 'engaged' THEN 3
        WHEN 'negotiating' THEN 4
        WHEN 'contracted' THEN 5
        WHEN 'closed' THEN 6
        WHEN 'lost' THEN 7
        ELSE 8
      END
  `;

  const funnelStages = ['new', 'contacted', 'engaged', 'negotiating', 'contracted', 'closed'];
  const results: FunnelStage[] = [];

  for (let i = 0; i < funnelStages.length; i++) {
    const stage = funnelStages[i];
    const data = stages.find((s) => s.status === stage);
    const nextStage = stages.find((s) => s.status === funnelStages[i + 1]);

    const count = Number(data?.count) || 0;
    const nextCount = Number(nextStage?.count) || 0;

    results.push({
      stage,
      count,
      conversionRate: count > 0 ? Math.round((nextCount / count) * 100 * 100) / 100 : 0,
      avgTimeInStageHours: Number(data?.avg_hours) || 0,
      dropOffRate: count > 0 ? Math.round(((count - nextCount) / count) * 100 * 100) / 100 : 0,
    });
  }

  return results;
}

/**
 * Get combined CRM dashboard analytics
 */
export async function getCRMDashboardAnalytics(
  organizationId: string,
  dateRange?: DateRange
): Promise<{
  regional: RegionalAnalytics[];
  outreach: OutreachMethodAnalytics[];
  attribution: ChannelAttribution[];
  funnel: FunnelStage[];
  summary: {
    totalLeads: number;
    activeLeads: number;
    totalConversions: number;
    totalRevenue: number;
    avgConversionRate: number;
    avgResponseTime: number;
    topPerformingRegion: string;
    topPerformingChannel: string;
  };
}> {
  const [regional, outreach, attribution, funnel] = await Promise.all([
    getRegionalAnalytics(organizationId, 'state', dateRange),
    getOutreachMethodAnalytics(organizationId, dateRange),
    getChannelAttribution(organizationId, dateRange),
    getConversionFunnel(organizationId, dateRange),
  ]);

  // Calculate summary
  const totalLeads = regional.reduce((sum, r) => sum + r.totalLeads, 0);
  const activeLeads = regional.reduce((sum, r) => sum + r.activeLeads, 0);
  const totalConversions = regional.reduce((sum, r) => sum + r.dealsClosed, 0);
  const totalRevenue = regional.reduce((sum, r) => sum + r.totalRevenue, 0);

  const avgConversionRate = totalLeads > 0
    ? Math.round((totalConversions / totalLeads) * 100 * 100) / 100
    : 0;

  const topRegion = regional.sort((a, b) => b.conversionRate - a.conversionRate)[0];
  const topChannel = outreach.sort((a, b) => b.conversionRate - a.conversionRate)[0];

  return {
    regional,
    outreach,
    attribution,
    funnel,
    summary: {
      totalLeads,
      activeLeads,
      totalConversions,
      totalRevenue,
      avgConversionRate,
      avgResponseTime: 0, // Would need response time tracking
      topPerformingRegion: topRegion?.state || 'N/A',
      topPerformingChannel: topChannel?.method || 'N/A',
    },
  };
}

/**
 * Export analytics to CSV
 */
export function analyticsToCSV(
  data: RegionalAnalytics[] | OutreachMethodAnalytics[],
  _type: 'regional' | 'outreach'
): string {
  if (data.length === 0) return '';

  const firstRow = data[0] as unknown as Record<string, unknown>;
  const headers = Object.keys(firstRow);
  const rows = data.map(row => {
    const r = row as unknown as Record<string, unknown>;
    return headers.map(h => String(r[h] ?? '')).join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}
