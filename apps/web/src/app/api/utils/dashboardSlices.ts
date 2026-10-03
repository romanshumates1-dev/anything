/**
 * Dashboard data slices — ONE implementation, TWO callers.
 *
 * WHY THIS FILE EXISTS (measured 2026-10-03)
 * ------------------------------------------
 * `/dashboard` is a client component whose cost is the SUM OF ITS FETCHES. Each
 * fetch is a separate Cloudflare Worker invocation with its own cold start and
 * its own round trip, so one dashboard load fired ~17 invocations and measured
 * ~9.4s to settle. `wrangler tail` attributed the per-endpoint CPU (13-23ms for
 * the dashboard slices, 144ms for /api/system/health) — it is the BREADTH of
 * round trips, not any single slow query, that costs the wall clock.
 *
 * The fix is to serve the same payloads from ONE invocation. That is only safe
 * if the individual endpoint and the batched endpoint cannot drift apart, so the
 * SQL/logic lives here and BOTH import it:
 *
 *   GET /api/dashboard/{stats,funnel,activity,next-actions,quick-stats,
 *                       engagements,weekly-progress}   -> thin wrappers
 *   GET /api/dashboard/summary                          -> all of them at once
 *
 * Nothing here authenticates: that stays in the route, so no slice can be
 * reached without a session.
 *
 * COST NOTE: the batched endpoint runs these CONCURRENTLY inside one invocation,
 * so its CPU is roughly the sum. That is why the client treats a missing slice
 * as "fetch it yourself" rather than failing: a batch that exceeds the Worker
 * CPU budget degrades to the old per-endpoint behaviour instead of blanking the
 * dashboard.
 */
import sql from '@/app/api/utils/sql';
import { logFallback } from '@/app/api/utils/queryFallback';
import { formatDistanceToNow } from 'date-fns';
import { getBalanceDetails, getAllCosts, getTransactionHistory } from '@/app/api/utils/credits';
import { getSubscriptionStatus } from '@/app/api/utils/subscriptionGuard';
import { getPipelineStatus } from '@/app/api/utils/pipelineOrchestrator';

/* ------------------------------------------------------------------ stats -- */

export interface DashboardStats {
  totalLeads: number;
  pendingJobs: number;
  auditCount: number;
  requiresHuman: number;
}

/**
 * SECURITY: All stats scoped to organization to prevent cross-tenant data leakage.
 *
 * Defect #43: `audit_logs` has no organization_id column (id, user_id, action,
 * target_type, target_id, payload, created_at), so that predicate 500'd and the
 * dashboard stats call failed. `jobs` has no organization_id either, so the
 * previous `SELECT count(*) FROM jobs WHERE status='pending'` was an UNSCOPED
 * system-wide count being served as if it were this tenant's — a real
 * cross-tenant aggregate, even though it is only a number.
 *
 * The genuine tenant link is `organization_members`, so both are scoped through
 * it. `jobs` is a shared system queue and cannot be attributed to a tenant at
 * all, so it is only counted when the job payload itself names the org.
 */
export async function getDashboardStats(orgId: string): Promise<DashboardStats> {
  const [[leadStats], [pendingJobs], [auditCount], [humanRequired]] = await sql.transaction([
    sql`SELECT count(*) FROM leads WHERE organization_id = ${orgId}`,
    sql`SELECT count(*) FROM jobs j
        WHERE j.status = 'pending'
          AND COALESCE(j.payload->>'organization_id', '') = ${orgId}`,
    sql`SELECT count(*) FROM audit_logs a
        WHERE a.user_id IN (
          SELECT om.user_id FROM organization_members om WHERE om.organization_id = ${orgId}
        )`,
    sql`SELECT count(*) FROM ai_conversations c JOIN leads l ON l.id = c.lead_id WHERE c.requires_human = TRUE AND l.organization_id = ${orgId}`,
  ]);

  return {
    totalLeads: parseInt(leadStats.count),
    pendingJobs: parseInt(pendingJobs.count),
    auditCount: parseInt(auditCount.count),
    requiresHuman: parseInt(humanRequired.count),
  };
}

/* ------------------------------------------------------------- quick stats -- */

export interface QuickStatsPayload {
  leads: { value: number; change: number };
  contacted: { value: number; change: number };
  responses: { value: number; change: number };
  deals: { value: number; change: number };
}

function calcChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

/** SECURITY: All queries scoped to organization. */
export async function getDashboardQuickStats(orgId: string): Promise<QuickStatsPayload> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  const [
    [leadsCurrentPeriod],
    [leadsPreviousPeriod],
    [contactedCurrentPeriod],
    [contactedPreviousPeriod],
    [responsesCurrentPeriod],
    [responsesPreviousPeriod],
    [dealsCurrentPeriod],
    [dealsPreviousPeriod],
  ] = await sql.transaction([
    sql`SELECT COUNT(*) FROM leads WHERE organization_id = ${orgId} AND created_at >= ${thirtyDaysAgo}`,
    sql`SELECT COUNT(*) FROM leads WHERE organization_id = ${orgId} AND created_at >= ${sixtyDaysAgo} AND created_at < ${thirtyDaysAgo}`,
    sql`SELECT COUNT(*) FROM leads WHERE organization_id = ${orgId} AND status IN ('contacted', 'responded', 'negotiating', 'under_contract', 'closed') AND updated_at >= ${thirtyDaysAgo}`,
    sql`SELECT COUNT(*) FROM leads WHERE organization_id = ${orgId} AND status IN ('contacted', 'responded', 'negotiating', 'under_contract', 'closed') AND updated_at >= ${sixtyDaysAgo} AND updated_at < ${thirtyDaysAgo}`,
    // Responses - current period.
    // Defect #38: this filtered on `message_type = 'inbound'`, a column that has
    // never existed on ai_conversations. The real columns are channel, history
    // (jsonb), status and last_message_at, so the whole dashboard 500'd with
    // `column "message_type" does not exist`. An inbound reply is recorded as
    // conversation ACTIVITY, so last_message_at is the honest signal: a
    // conversation whose last message arrived inside the window means the lead
    // responded during it. No invented column, no fake data.
    sql`SELECT COUNT(*) FROM ai_conversations WHERE lead_id IN (SELECT id FROM leads WHERE organization_id = ${orgId}) AND last_message_at >= ${thirtyDaysAgo}`,
    sql`SELECT COUNT(*) FROM ai_conversations WHERE lead_id IN (SELECT id FROM leads WHERE organization_id = ${orgId}) AND last_message_at >= ${sixtyDaysAgo} AND last_message_at < ${thirtyDaysAgo}`,
    sql`SELECT COUNT(*) FROM leads WHERE organization_id = ${orgId} AND status = 'closed' AND updated_at >= ${thirtyDaysAgo}`,
    sql`SELECT COUNT(*) FROM leads WHERE organization_id = ${orgId} AND status = 'closed' AND updated_at >= ${sixtyDaysAgo} AND updated_at < ${thirtyDaysAgo}`,
  ]);

  const leadsCurrent = parseInt(leadsCurrentPeriod.count) || 0;
  const leadsPrevious = parseInt(leadsPreviousPeriod.count) || 0;
  const contactedCurrent = parseInt(contactedCurrentPeriod.count) || 0;
  const contactedPrevious = parseInt(contactedPreviousPeriod.count) || 0;
  const responsesCurrent = parseInt(responsesCurrentPeriod.count) || 0;
  const responsesPrevious = parseInt(responsesPreviousPeriod.count) || 0;
  const dealsCurrent = parseInt(dealsCurrentPeriod.count) || 0;
  const dealsPrevious = parseInt(dealsPreviousPeriod.count) || 0;

  return {
    leads: { value: leadsCurrent, change: calcChange(leadsCurrent, leadsPrevious) },
    contacted: { value: contactedCurrent, change: calcChange(contactedCurrent, contactedPrevious) },
    responses: { value: responsesCurrent, change: calcChange(responsesCurrent, responsesPrevious) },
    deals: { value: dealsCurrent, change: calcChange(dealsCurrent, dealsPrevious) },
  };
}

/* ----------------------------------------------------------------- funnel -- */

export interface FunnelPayload {
  stages: Array<{ id: string; count: number; trend: number }>;
  avgDealValue: number;
  projectedRevenue: number;
  period: string;
}

/** SECURITY: All queries scoped to organization. */
export async function getDashboardFunnel(orgId: string): Promise<FunnelPayload> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  const [
    [totalLeads],
    [contacted],
    [responded],
    [negotiating],
    [underContract],
    [closed],
  ] = await sql.transaction([
    sql`SELECT COUNT(*) FROM leads WHERE organization_id = ${orgId} AND created_at >= ${thirtyDaysAgo}`,
    sql`SELECT COUNT(*) FROM leads WHERE organization_id = ${orgId} AND status IN ('contacted', 'responded', 'negotiating', 'under_contract', 'closed') AND created_at >= ${thirtyDaysAgo}`,
    sql`SELECT COUNT(*) FROM leads WHERE organization_id = ${orgId} AND status IN ('responded', 'negotiating', 'under_contract', 'closed') AND created_at >= ${thirtyDaysAgo}`,
    sql`SELECT COUNT(*) FROM leads WHERE organization_id = ${orgId} AND status IN ('negotiating', 'under_contract', 'closed') AND created_at >= ${thirtyDaysAgo}`,
    sql`SELECT COUNT(*) FROM leads WHERE organization_id = ${orgId} AND status IN ('under_contract', 'closed') AND created_at >= ${thirtyDaysAgo}`,
    sql`SELECT COUNT(*) FROM leads WHERE organization_id = ${orgId} AND status = 'closed' AND created_at >= ${thirtyDaysAgo}`,
  ]);

  const [
    [prevTotalLeads],
    [prevContacted],
    [prevResponded],
    [prevNegotiating],
    [prevUnderContract],
    [prevClosed],
  ] = await sql.transaction([
    sql`SELECT COUNT(*) FROM leads WHERE organization_id = ${orgId} AND created_at >= ${sixtyDaysAgo} AND created_at < ${thirtyDaysAgo}`,
    sql`SELECT COUNT(*) FROM leads WHERE organization_id = ${orgId} AND status IN ('contacted', 'responded', 'negotiating', 'under_contract', 'closed') AND created_at >= ${sixtyDaysAgo} AND created_at < ${thirtyDaysAgo}`,
    sql`SELECT COUNT(*) FROM leads WHERE organization_id = ${orgId} AND status IN ('responded', 'negotiating', 'under_contract', 'closed') AND created_at >= ${sixtyDaysAgo} AND created_at < ${thirtyDaysAgo}`,
    sql`SELECT COUNT(*) FROM leads WHERE organization_id = ${orgId} AND status IN ('negotiating', 'under_contract', 'closed') AND created_at >= ${sixtyDaysAgo} AND created_at < ${thirtyDaysAgo}`,
    sql`SELECT COUNT(*) FROM leads WHERE organization_id = ${orgId} AND status IN ('under_contract', 'closed') AND created_at >= ${sixtyDaysAgo} AND created_at < ${thirtyDaysAgo}`,
    sql`SELECT COUNT(*) FROM leads WHERE organization_id = ${orgId} AND status = 'closed' AND created_at >= ${sixtyDaysAgo} AND created_at < ${thirtyDaysAgo}`,
  ]);

  const calculateTrend = (current: number, previous: number): number => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 100);
  };

  const currentCounts = {
    leads: parseInt(totalLeads.count) || 0,
    contacted: parseInt(contacted.count) || 0,
    responded: parseInt(responded.count) || 0,
    negotiating: parseInt(negotiating.count) || 0,
    contract: parseInt(underContract.count) || 0,
    closed: parseInt(closed.count) || 0,
  };

  const prevCounts = {
    leads: parseInt(prevTotalLeads.count) || 0,
    contacted: parseInt(prevContacted.count) || 0,
    responded: parseInt(prevResponded.count) || 0,
    negotiating: parseInt(prevNegotiating.count) || 0,
    contract: parseInt(prevUnderContract.count) || 0,
    closed: parseInt(prevClosed.count) || 0,
  };

  // Average deal value.
  // Defect #44: `leads.deal_value` has never existed, so this 500'd and the
  // funnel could not render. The real value lives in `leads.metadata` as
  // `propertyValue` (verified against the live rows), which is the assessed
  // property value - the honest basis for an average deal size here.
  //
  // The no-rows case averages to 0, NOT to a seed figure. This query used to
  // `COALESCE(..., 8500)` and the card used to default to 8500 as well, so a
  // wholesaler with no closed deals was shown an "$8,500 average deal" and a
  // $102,000 projected revenue derived from that invented constant.
  const [avgDealResult] = await sql`
    SELECT COALESCE(AVG(NULLIF(metadata->>'propertyValue', '')::numeric), 0) as avg_value
    FROM leads
    WHERE organization_id = ${orgId}
      AND status = 'closed'
      AND NULLIF(metadata->>'propertyValue', '') ~ '^[0-9.]+$'
  `;

  const avgDealValue = Math.round(parseFloat(avgDealResult?.avg_value || '0'));
  const projectedRevenue = currentCounts.contract * avgDealValue;

  return {
    stages: [
      { id: 'leads', count: currentCounts.leads, trend: calculateTrend(currentCounts.leads, prevCounts.leads) },
      { id: 'contacted', count: currentCounts.contacted, trend: calculateTrend(currentCounts.contacted, prevCounts.contacted) },
      { id: 'responded', count: currentCounts.responded, trend: calculateTrend(currentCounts.responded, prevCounts.responded) },
      { id: 'negotiating', count: currentCounts.negotiating, trend: calculateTrend(currentCounts.negotiating, prevCounts.negotiating) },
      { id: 'contract', count: currentCounts.contract, trend: calculateTrend(currentCounts.contract, prevCounts.contract) },
      { id: 'closed', count: currentCounts.closed, trend: calculateTrend(currentCounts.closed, prevCounts.closed) },
    ],
    avgDealValue,
    projectedRevenue,
    period: '30d',
  };
}

/* ------------------------------------------------------------ engagements -- */

export interface Engagement {
  id: string;
  leadId?: string;
  leadName: string;
  propertyAddress: string;
  type: 'response' | 'interested' | 'not_interested' | 'callback' | 'hot_lead';
  message?: string;
  timestamp: string;
  campaignName?: string;
}

/**
 * DEFECT FIXED WHILE EXTRACTING (2026-10-03): the previous version SELECTed
 * c.id, c.channel, c.status, c.requires_human, c.confidence_score,
 * c.last_message_at, c.created_at, l.name, l.metadata->>'state', camp.name -
 * then mapped `row.first_name`, `row.last_name`, `row.property_address`,
 * `row.property_city`, `row.property_state`, `row.classification` and
 * `row.content`. NONE of first_name/last_name/property_address/property_city/
 * classification/content were ever selected, so every card rendered the literal
 * placeholders "Unknown" / "Address unavailable" and the engagement type was
 * hard-wired to 'response' (`mapClassification(null)`). The endpoint returned
 * 200 with a payload that could not be right, which is why no test caught it.
 *
 * Now mapped from columns the query actually returns. `type` comes from the one
 * real escalation signal on the row (`requires_human`); there is no
 * classification column to read, so no fabricated category is invented.
 * `timestamp` is last_message_at (when the lead last engaged) rather than
 * created_at (when the conversation row was first written).
 */
export async function getDashboardEngagements(orgId: string): Promise<{ engagements: Engagement[] }> {
  // SECURITY: All queries scoped to organization.
  const recentResponses = await sql`
    SELECT
      c.id,
      c.lead_id,
      c.channel,
      c.status,
      c.requires_human,
      c.confidence_score,
      c.last_message_at,
      c.created_at,
      l.name as lead_name,
      l.metadata->>'address' as property_address,
      l.metadata->>'state' as property_state,
      camp.name as campaign_name
    FROM ai_conversations c
    JOIN leads l ON l.id = c.lead_id
    LEFT JOIN campaign_leads cl ON cl.lead_id = l.id
    LEFT JOIN campaigns camp ON camp.id = cl.campaign_id
    WHERE l.organization_id = ${orgId}
      AND c.last_message_at IS NOT NULL
      AND c.last_message_at >= NOW() - INTERVAL '7 days'
    ORDER BY c.last_message_at DESC
    LIMIT 20
  `;

  const engagements: Engagement[] = recentResponses.map((row: any) => ({
    id: row.id,
    leadId: row.lead_id !== null && row.lead_id !== undefined ? String(row.lead_id) : undefined,
    leadName: row.lead_name || 'Unknown',
    propertyAddress:
      row.property_address || (row.property_state ? `State: ${row.property_state}` : 'Address unavailable'),
    type: row.requires_human ? 'hot_lead' : 'response',
    timestamp: row.last_message_at || row.created_at,
    campaignName: row.campaign_name ?? undefined,
  }));

  return { engagements };
}

/* ---------------------------------------------------------- weekly progress -- */

export interface WeeklyProgressPayload {
  leadsContacted: number;
  leadsContactedLastWeek: number;
  responsesReceived: number;
  responsesLastWeek: number;
  dealsInProgress: number;
  dealsLastWeek: number;
  dealsClosed: number;
  dealsClosedLastWeek: number;
  streak: number;
  milestone: { type: string; value: number; label: string } | null;
}

/**
 * Weekly progress summary (defect #47, rewritten 2026-09-29 against the REAL
 * schema verified via information_schema).
 *
 * Real sources used:
 *   - contacted this/last week -> campaign_lead_queue.last_sent_at (org-scoped)
 *   - responses this/last week -> campaign_lead_queue.last_reply_at
 *   - deals in progress        -> leads.status IN ('negotiating','under_contract')
 *   - closed deals             -> leads.status = 'closed'
 *   - activity streak          -> distinct days with an outbound message_events row
 *   - total contacted          -> distinct leads in the queue, all time
 *
 * Every query carries its own logFallback toward a zero row, so one broken
 * source degrades that ONE counter (visibly, in the log) instead of silently
 * zeroing the whole widget. The caller still returns 500 if something outside
 * these fallbacks throws - a 200 full of zeros would be the defect #47 lie.
 */
export async function getDashboardWeeklyProgress(orgId: string): Promise<WeeklyProgressPayload> {
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
    WHERE organization_id = ${orgId}
      AND last_sent_at >= ${thisWeekStart.toISOString()}
  `.catch(logFallback('weekly-progress#contacted-this-week', ZERO));

  const [lastWeekContacted] = await sql`
    SELECT count(DISTINCT lead_id) as count
    FROM campaign_lead_queue
    WHERE organization_id = ${orgId}
      AND last_sent_at >= ${lastWeekStart.toISOString()}
      AND last_sent_at < ${thisWeekStart.toISOString()}
  `.catch(logFallback('weekly-progress#contacted-last-week', ZERO));

  // Responses = a queued lead that replied in the window.
  const [thisWeekResponses] = await sql`
    SELECT count(DISTINCT lead_id) as count
    FROM campaign_lead_queue
    WHERE organization_id = ${orgId}
      AND last_reply_at >= ${thisWeekStart.toISOString()}
  `.catch(logFallback('weekly-progress#responses-this-week', ZERO));

  const [lastWeekResponses] = await sql`
    SELECT count(DISTINCT lead_id) as count
    FROM campaign_lead_queue
    WHERE organization_id = ${orgId}
      AND last_reply_at >= ${lastWeekStart.toISOString()}
      AND last_reply_at < ${thisWeekStart.toISOString()}
  `.catch(logFallback('weekly-progress#responses-last-week', ZERO));

  // Deals in progress (real column: leads.status, not stage).
  const [thisWeekDeals] = await sql`
    SELECT count(*) as count
    FROM leads
    WHERE organization_id = ${orgId}
      AND status IN ('negotiating', 'under_contract')
      AND updated_at >= ${thisWeekStart.toISOString()}
  `.catch(logFallback('weekly-progress#deals-this-week', ZERO));

  const [lastWeekDeals] = await sql`
    SELECT count(*) as count
    FROM leads
    WHERE organization_id = ${orgId}
      AND status IN ('negotiating', 'under_contract')
      AND updated_at >= ${lastWeekStart.toISOString()}
      AND updated_at < ${thisWeekStart.toISOString()}
  `.catch(logFallback('weekly-progress#deals-last-week', ZERO));

  // Closed deals.
  const [thisWeekClosed] = await sql`
    SELECT count(*) as count
    FROM leads
    WHERE organization_id = ${orgId}
      AND status = 'closed'
      AND updated_at >= ${thisWeekStart.toISOString()}
  `.catch(logFallback('weekly-progress#closed-this-week', ZERO));

  const [lastWeekClosed] = await sql`
    SELECT count(*) as count
    FROM leads
    WHERE organization_id = ${orgId}
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
      WHERE organization_id = ${orgId}
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
    WHERE organization_id = ${orgId}
  `.catch(logFallback('weekly-progress#total-contacted', ZERO));

  let milestone: WeeklyProgressPayload['milestone'] = null;
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

  return {
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
  };
}

/* --------------------------------------------------------------- activity -- */

export type ActivityType =
  | 'deal_closed'
  | 'contract_signed'
  | 'message_sent'
  | 'lead_added'
  | 'response_received'
  | 'hot_lead'
  | 'campaign_started'
  | 'alert';

export interface ActivityItem {
  id: string;
  type: ActivityType;
  title: string;
  description?: string;
  timestamp: string;
  metadata?: {
    amount?: number;
    campaignName?: string;
    propertyAddress?: string;
    leadId?: string;
  };
}

/**
 * Dashboard activity feed (defect #46, rewritten 2026-09-29 against the REAL
 * schema verified via information_schema):
 *
 * The previous version was written against tables/columns that have never
 * existed in this database - `inbound_messages`, `outreach_log`,
 * `leads.property_address`, `leads.first_name/last_name`, `leads.deal_value`,
 * `leads.stage`, `campaigns.member_count` - so the FIRST query threw and one
 * outer `.catch` converted the whole endpoint into `{"activities": []}` with a
 * 200. The dashboard looked "empty but working" while every query failed.
 *
 * Every query carries its own logFallback: one broken source now degrades that
 * ONE list (visibly, in the log) instead of silently zeroing the whole feed, and
 * the caller returns 500 rather than a fake-empty 200.
 */
export async function getDashboardActivity(orgId: string, limit = 20): Promise<{ activities: ActivityItem[] }> {
  const activities: ActivityItem[] = [];

  // 1. Closed deals. Value and address live in leads.metadata (jsonb); the
  //    numeric guard mirrors dashboard/funnel's approach so a malformed
  //    propertyValue can never throw a cast error.
  const closedDeals = await sql`
    SELECT l.id,
           COALESCE(l.metadata->>'address', l.name) AS label,
           l.updated_at,
           CASE WHEN COALESCE(l.metadata->>'propertyValue', '') ~ '^[0-9.]+$'
                THEN (l.metadata->>'propertyValue')::numeric
                ELSE 0 END AS deal_value
    FROM leads l
    WHERE l.organization_id = ${orgId}
      AND l.status = 'closed'
      AND l.updated_at >= NOW() - INTERVAL '7 days'
    ORDER BY l.updated_at DESC
    LIMIT 5
  `.catch(logFallback('dashboard-activity#closed-deals', []));

  for (const deal of closedDeals as any[]) {
    activities.push({
      id: `deal-${deal.id}`,
      type: 'deal_closed',
      title: 'Deal closed',
      description: deal.label || 'Property',
      timestamp: deal.updated_at,
      metadata: {
        amount: Number(deal.deal_value) || 0,
        propertyAddress: deal.label,
        leadId: String(deal.id),
      },
    });
  }

  // 2. Hot leads: leads the queue marked interested in the last 7 days.
  const hotLeads = await sql`
    SELECT clq.lead_id,
           l.name,
           COALESCE(l.metadata->>'address', l.city, l.name) AS label,
           clq.updated_at AS ts
    FROM campaign_lead_queue clq
    JOIN leads l ON l.id = clq.lead_id
    WHERE clq.organization_id = ${orgId}
      AND clq.status = 'interested'
      AND clq.updated_at >= NOW() - INTERVAL '7 days'
    ORDER BY clq.updated_at DESC
    LIMIT 5
  `.catch(logFallback('dashboard-activity#hot-leads', []));

  for (const lead of hotLeads as any[]) {
    activities.push({
      id: `hot-${lead.lead_id}`,
      type: 'hot_lead',
      title: 'Hot lead detected',
      description: lead.name || 'Lead',
      timestamp: lead.ts,
      metadata: {
        propertyAddress: lead.label,
        leadId: String(lead.lead_id),
      },
    });
  }

  // 3. Recent inbound responses from the message ledger. Contact details come
  //    from campaign_contacts (the reply is logged against the contact).
  const responses = await sql`
    SELECT me.id,
           me.created_at AS ts,
           COALESCE(cc.name, 'Lead') AS name,
           COALESCE(cc.property_address, cc.city, '') AS label,
           cc.seller_lead_id AS lead_id
    FROM message_events me
    LEFT JOIN campaign_contacts cc ON cc.id = me.contact_id
    WHERE me.organization_id = ${orgId}
      AND me.direction = 'inbound'
      AND me.created_at >= NOW() - INTERVAL '7 days'
    ORDER BY me.created_at DESC
    LIMIT 5
  `.catch(logFallback('dashboard-activity#responses', []));

  for (const resp of responses as any[]) {
    activities.push({
      id: `resp-${resp.id}`,
      type: 'response_received',
      title: 'New response',
      description: resp.name || 'Lead',
      timestamp: resp.ts,
      metadata: {
        propertyAddress: resp.label || undefined,
        leadId: resp.lead_id ? String(resp.lead_id) : undefined,
      },
    });
  }

  // 4. Campaign launches (member_count via the queue, since campaigns has no
  //    such column).
  const campaigns = await sql`
    SELECT c.id, c.name, c.created_at,
           (SELECT COUNT(*) FROM campaign_lead_queue q
            WHERE q.campaign_id = c.id::text
              AND q.organization_id = ${orgId}) AS member_count
    FROM campaigns c
    WHERE c.organization_id = ${orgId}
      AND c.status IN ('active', 'running')
      AND c.created_at >= NOW() - INTERVAL '7 days'
    ORDER BY c.created_at DESC
    LIMIT 5
  `.catch(logFallback('dashboard-activity#campaigns', []));

  for (const campaign of campaigns as any[]) {
    activities.push({
      id: `camp-${campaign.id}`,
      type: 'campaign_started',
      title: 'Campaign launched',
      description: `${campaign.name} - ${Number(campaign.member_count) || 0} leads`,
      timestamp: campaign.created_at,
      metadata: {
        campaignName: campaign.name,
      },
    });
  }

  // 5. High-volume outbound days from the message ledger. Grouped by the
  //    ledger's own campaign_id (org-bound) - no join to a table that may not
  //    carry the campaign.
  const outreachBatches = await sql`
    SELECT COALESCE(NULLIF(me.campaign_id, ''), 'Direct message') AS name,
           COUNT(*) AS count,
           MAX(me.created_at) AS latest
    FROM message_events me
    WHERE me.organization_id = ${orgId}
      AND me.direction = 'outbound'
      AND me.created_at >= NOW() - INTERVAL '1 day'
    GROUP BY 1
    HAVING COUNT(*) >= 10
    ORDER BY latest DESC
    LIMIT 5
  `.catch(logFallback('dashboard-activity#outreach-batches', []));

  for (const batch of outreachBatches as any[]) {
    activities.push({
      id: `outreach-${batch.name}-${batch.latest}`,
      type: 'message_sent',
      title: `${batch.count} messages sent`,
      description: batch.name,
      timestamp: batch.latest,
      metadata: {
        campaignName: batch.name,
      },
    });
  }

  // 6. Newly added leads (columns verified real).
  const newLeads = await sql`
    SELECT COUNT(*) as count, MIN(id) as sample_id, MAX(created_at) as latest
    FROM leads
    WHERE organization_id = ${orgId}
      AND created_at >= NOW() - INTERVAL '1 day'
    GROUP BY DATE_TRUNC('hour', created_at)
    HAVING COUNT(*) >= 5
    ORDER BY latest DESC
    LIMIT 3
  `.catch(logFallback('dashboard-activity#new-leads', []));

  for (const batch of newLeads as any[]) {
    activities.push({
      id: `leads-${batch.latest}`,
      type: 'lead_added',
      title: `${batch.count} new leads imported`,
      description: 'From data source',
      timestamp: batch.latest,
    });
  }

  // Sort all activities by timestamp and limit
  activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return { activities: activities.slice(0, limit) };
}

/* ----------------------------------------------------------- next actions -- */

export interface NextAction {
  id: string;
  type: 'call' | 'contract' | 'follow_up' | 'response' | 'urgent';
  title: string;
  description: string;
  dueIn?: string;
  href: string;
  priority: 'high' | 'medium' | 'low';
}

/** SECURITY: All queries scoped to organization. */
export async function getDashboardNextActions(orgId: string): Promise<{ actions: NextAction[] }> {
  const actions: NextAction[] = [];

  // 1. Hot leads that need immediate attention (responded recently with interest)
  const hotLeads = await sql`
    SELECT
      l.id,
      l.name,
      l.metadata->>'address' as property_address,
      c.created_at,
      c.history
    FROM leads l
    JOIN ai_conversations c ON c.lead_id = l.id
    WHERE l.organization_id = ${orgId}
      AND c.last_message_at IS NOT NULL
      AND c.requires_human = TRUE
      AND c.created_at >= NOW() - INTERVAL '24 hours'
    ORDER BY c.created_at DESC
    LIMIT 5
  `;

  for (const lead of hotLeads) {
    const timeSince = formatDistanceToNow(new Date(lead.created_at), { addSuffix: false });
    actions.push({
      id: `hot-${lead.id}`,
      type: 'urgent',
      title: `Hot lead: ${lead.name || 'Lead'} wants to sell`,
      description: `${lead.property_address || 'Property'} - Responded ${timeSince} ago`,
      dueIn: 'Now',
      href: `/crm?lead=${lead.id}`,
      priority: 'high',
    });
  }

  // 2. Conversations requiring human escalation
  const humanRequired = await sql`
    SELECT
      l.id,
      l.name,
      l.metadata->>'address' as property_address,
      c.created_at
    FROM ai_conversations c
    JOIN leads l ON l.id = c.lead_id
    WHERE l.organization_id = ${orgId}

    ORDER BY c.created_at DESC
    LIMIT 5
  `;

  for (const lead of humanRequired) {
    actions.push({
      id: `human-${lead.id}`,
      type: 'response',
      title: `Review conversation with ${lead.name || 'Lead'}`,
      description: `${lead.property_address || 'Property'} - AI needs assistance`,
      dueIn: 'Today',
      href: `/crm?lead=${lead.id}`,
      priority: 'high',
    });
  }

  // 3. Contracts awaiting signature
  // Defect #45: this selected c.expiration_date and joined on c.lead_id.
  // `contracts` really has (id, organization_id, template_id, direction,
  // seller_lead_id, filled_body, pdf_url, status, signed_at, created_at,
  // updated_at, assignment_fee_cents, inspection_days, contract_price_cents,
  // assigned_at, esign_status, fee_collection, fee_config, origination_type,
  // buyer_id, metadata) - there is NO expiration_date and NO lead_id, so the
  // query 500'd.
  //
  // "Expiring soon" is therefore not derivable from stored data and is not
  // faked. The honest, genuinely actionable signal is a contract still awaiting
  // signature, which IS recorded (status/esign_status + assigned_at).
  const expiringContracts = await sql`
    SELECT
      c.id,
      c.status,
      c.esign_status,
      c.direction,
      c.assigned_at,
      c.created_at,
      c.assignment_fee_cents,
      l.id as lead_id,
      l.name as lead_name,
      l.metadata->>'address' as property_address
    FROM contracts c
    -- Defect #45 (cont): contracts.seller_lead_id is TEXT while leads.id is
    -- INTEGER, so joining them directly raised
    -- "operator does not exist: integer = text". Verified via
    -- information_schema rather than guessed. The cast is explicit and the
    -- non-matching case simply produces no join row.
    JOIN leads l ON l.id = c.seller_lead_id::int
    WHERE c.organization_id = ${orgId}
      AND c.signed_at IS NULL
      AND COALESCE(c.esign_status, c.status) IN ('sent', 'pending', 'awaiting_signature', 'draft')
    ORDER BY c.created_at DESC
    LIMIT 5
  `;

  for (const contract of expiringContracts) {
    const daysSince = Math.max(
      0,
      Math.ceil((Date.now() - new Date(contract.created_at).getTime()) / (1000 * 60 * 60 * 24))
    );
    actions.push({
      id: `contract-${contract.id}`,
      type: 'contract',
      title: 'Contract awaiting signature',
      description: `${contract.property_address || 'Property'} - ${
        contract.lead_name || 'Lead'
      } (sent ${daysSince} day${daysSince === 1 ? '' : 's'} ago)`,
      dueIn: daysSince >= 5 ? 'Overdue' : 'Today',
      href: `/contracts?id=${contract.id}`,
      priority: daysSince >= 5 ? 'high' : 'medium',
    });
  }

  // 4. Follow-ups needed (no response in 5+ days)
  const followUps = await sql`
    SELECT
      l.id,
      l.name,
      l.metadata->>'address' as property_address,
      l.updated_at
    FROM leads l
    WHERE l.organization_id = ${orgId}
      AND l.status = 'contacted'
      AND l.updated_at <= NOW() - INTERVAL '5 days'
      AND l.updated_at >= NOW() - INTERVAL '30 days'
    ORDER BY l.updated_at ASC
    LIMIT 5
  `;

  for (const lead of followUps) {
    const daysSince = Math.floor(
      (Date.now() - new Date(lead.updated_at).getTime()) / (1000 * 60 * 60 * 24)
    );
    actions.push({
      id: `followup-${lead.id}`,
      type: 'follow_up',
      title: `Follow up with ${lead.name || 'Lead'}`,
      description: `${lead.property_address || 'Property'} - No response in ${daysSince} days`,
      dueIn: 'This week',
      href: `/crm?lead=${lead.id}`,
      priority: 'low',
    });
  }

  // Sort by priority
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  actions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return { actions: actions.slice(0, 10) };
}

/* -------------------------------------------------------------- campaigns -- */

export interface CampaignSliceRow {
  id: string;
  name: string;
  status: string;
  member_count: number;
  sent_count: number;
  created_at: string;
  [key: string]: unknown;
}

/**
 * Tenant-isolation fix: this route previously returned every org's campaigns
 * with no filtering at all.
 */
export async function getCampaigns(orgId: string): Promise<CampaignSliceRow[]> {
  return (await sql`
    SELECT
      c.*,
      COUNT(cl.id) AS member_count,
      COUNT(cl.id) FILTER (WHERE cl.status = 'sent') AS sent_count
    FROM campaigns c
    LEFT JOIN campaign_leads cl ON cl.campaign_id = c.id
    WHERE c.organization_id = ${orgId}
    GROUP BY c.id
    ORDER BY c.created_at DESC
    LIMIT 100
  `) as unknown as CampaignSliceRow[];
}

/* ---------------------------------------------------------------- credits -- */

export interface CreditsPayload {
  balance: number;
  lifetimePurchased: number;
  lifetimeUsed: number;
  tier: string;
  costs: Record<string, number>;
  transactions?: Array<{
    id: string;
    type: string;
    amount: number;
    balanceAfter: number;
    description: string;
    createdAt: string;
  }>;
}

/**
 * Same payload as `GET /api/credits`.
 *
 * `includeHistory` exists because the standalone endpoint only pays for the
 * transaction query when asked (`?history=true`), while the batched dashboard
 * call always wants it — the dashboard card and the inline header balance share
 * one React Query key, so one payload has to serve both.
 */
export async function getCredits(
  orgId: string,
  options: { includeHistory?: boolean; historyLimit?: number } = {}
): Promise<CreditsPayload> {
  const { includeHistory = true, historyLimit = 10 } = options;

  const subscription = await getSubscriptionStatus(orgId);
  const tier = subscription?.tier || 'free';

  const [balanceDetails, costs] = await Promise.all([
    getBalanceDetails(orgId),
    getAllCosts(tier),
  ]);

  const payload: CreditsPayload = {
    balance: balanceDetails.balance,
    lifetimePurchased: balanceDetails.lifetimePurchased,
    lifetimeUsed: balanceDetails.lifetimeUsed,
    tier: tier.toLowerCase(),
    costs,
  };

  if (includeHistory) {
    const transactions = await getTransactionHistory(orgId, historyLimit);
    payload.transactions = transactions.map((t) => ({
      id: t.id,
      type: t.type,
      amount: t.amount,
      balanceAfter: t.balanceAfter,
      description: t.description,
      createdAt: t.createdAt.toISOString(),
    }));
  }

  return payload;
}

/* --------------------------------------------------------------- pipeline -- */

export async function getDashboardPipeline(orgId: string): Promise<{ status: unknown }> {
  return { status: await getPipelineStatus(orgId) };
}

/* ----------------------------------------------------------- batch summary -- */

/**
 * The batched payload. Every key is OPTIONAL on purpose: a slice that fails is
 * omitted (and named in `errors`) instead of taking the whole dashboard down.
 * The client reads a missing key as "fetch that one yourself", so a partial
 * failure degrades to the pre-batch behaviour for that card only.
 */
export interface DashboardSummaryPayload {
  stats?: DashboardStats;
  campaigns?: CampaignSliceRow[];
  credits?: CreditsPayload;
  funnel?: FunnelPayload;
  activity?: { activities: ActivityItem[] };
  nextActions?: { actions: NextAction[] };
  quickStats?: QuickStatsPayload;
  engagements?: { engagements: Engagement[] };
  weeklyProgress?: WeeklyProgressPayload;
  pipeline?: { status: unknown };
  errors?: Record<string, string>;
}

/**
 * Runs every dashboard slice CONCURRENTLY in one Worker invocation.
 *
 * Why allSettled and not all: the caller is a dashboard, not a transaction. One
 * broken slice (or a table that a migration has not reached yet) must not blank
 * nine working cards, and `Promise.all` would do exactly that.
 */
export async function buildDashboardSummary(orgId: string): Promise<DashboardSummaryPayload> {
  const slices: Record<string, () => Promise<unknown>> = {
    stats: () => getDashboardStats(orgId),
    campaigns: () => getCampaigns(orgId),
    credits: () => getCredits(orgId),
    funnel: () => getDashboardFunnel(orgId),
    activity: () => getDashboardActivity(orgId),
    nextActions: () => getDashboardNextActions(orgId),
    quickStats: () => getDashboardQuickStats(orgId),
    engagements: () => getDashboardEngagements(orgId),
    weeklyProgress: () => getDashboardWeeklyProgress(orgId),
    pipeline: () => getDashboardPipeline(orgId),
  };

  const names = Object.keys(slices);
  const settled = await Promise.allSettled(names.map((name) => slices[name]()));

  const payload: Record<string, unknown> = {};
  const errors: Record<string, string> = {};

  settled.forEach((result, index) => {
    const name = names[index];
    if (result.status === 'fulfilled') {
      payload[name] = result.value;
      return;
    }
    const message =
      result.reason instanceof Error ? result.reason.message : String(result.reason);
    errors[name] = message.slice(0, 300);
    console.error(`[dashboard/summary] slice "${name}" failed:`, result.reason);
  });

  if (Object.keys(errors).length > 0) payload.errors = errors;

  return payload as DashboardSummaryPayload;
}
