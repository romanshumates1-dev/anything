/**
 * Tier-based usage limit enforcement service.
 *
 * Provides limit checking and enforcement for free/paid tiers.
 * Designed to be transparent about limits - no dark patterns.
 */
import sql from '@/app/api/utils/sql';
import { recordUsage, getCurrentUsage, type UsageMetric } from './usageTracker';

export type TierMetric = UsageMetric | 'lead' | 'campaign' | 'email';

export interface TierLimits {
  monthly_lead_allowance: number;
  monthly_sms_allowance: number;
  monthly_email_allowance: number;
  ai_request_allowance: number;
  campaigns: number; // -1 = unlimited
  seats: number;
  api_rate_limit_per_minute: number;
  automation_limit: number;
  workflow_limit: number;
  is_free_tier?: boolean;
}

export interface LimitCheckResult {
  allowed: boolean;
  current: number;
  limit: number;
  remaining: number;
  percentUsed: number;
  tier: string;
  isFreeTier: boolean;
  message?: string;
  upgradeReason?: string;
}

export interface SubscriptionInfo {
  planId: string;
  planName: string;
  tier: string;
  status: string;
  limits: TierLimits;
  isFreeTier: boolean;
  trialEndsAt?: string;
  daysRemaining?: number;
}

/**
 * Get the current subscription for an organization.
 * Falls back to free tier if no subscription exists.
 */
export async function getSubscription(organizationId: string): Promise<SubscriptionInfo> {
  const rows = await sql`
    SELECT os.id, os.status, os.trial_ends_at,
           p.id as plan_id, p.name as plan_name, p.tier, p.limits
    FROM organization_subscriptions os
    JOIN subscription_plans p ON p.id = os.plan_id
    WHERE os.organization_id = ${organizationId}
    AND os.status IN ('trial', 'active')
    ORDER BY os.created_at DESC
    LIMIT 1
  `;

  const sub = rows[0] as any;

  if (sub) {
    const limits = sub.limits as TierLimits;
    const trialEndsAt = sub.trial_ends_at ? new Date(sub.trial_ends_at) : null;
    const daysRemaining = trialEndsAt
      ? Math.ceil((trialEndsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      : undefined;

    return {
      planId: sub.plan_id,
      planName: sub.plan_name,
      tier: sub.tier,
      status: sub.status,
      limits,
      isFreeTier: limits.is_free_tier === true || sub.tier === 'free',
      trialEndsAt: sub.trial_ends_at,
      daysRemaining,
    };
  }

  // No subscription found - return free tier defaults
  const freeRows = await sql`
    SELECT id as plan_id, name as plan_name, tier, limits
    FROM subscription_plans
    WHERE tier = 'free'
    LIMIT 1
  `;

  const freePlan = freeRows[0] as any;

  if (freePlan) {
    return {
      planId: freePlan.plan_id,
      planName: freePlan.plan_name,
      tier: 'free',
      status: 'active',
      limits: freePlan.limits as TierLimits,
      isFreeTier: true,
    };
  }

  // Absolute fallback - hardcoded free tier limits
  return {
    planId: 'plan_free',
    planName: 'Free',
    tier: 'free',
    status: 'active',
    limits: {
      monthly_lead_allowance: 10,
      monthly_sms_allowance: 25,
      monthly_email_allowance: 50,
      ai_request_allowance: 10,
      campaigns: 1,
      seats: 1,
      api_rate_limit_per_minute: 10,
      automation_limit: 1,
      workflow_limit: 1,
      is_free_tier: true,
    },
    isFreeTier: true,
  };
}

/**
 * Get period boundaries for usage tracking (monthly).
 */
function getPeriodBoundaries(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

/**
 * Get current usage for a specific metric.
 */
async function getMetricUsage(organizationId: string, metric: TierMetric): Promise<number> {
  // For campaign count, we count actual campaigns, not ledger entries
  if (metric === 'campaign') {
    const { start, end } = getPeriodBoundaries();
    const rows = await sql`
      SELECT COUNT(*) as count FROM campaigns
      WHERE organization_id = ${organizationId}
      AND created_at >= ${start.toISOString()}
      AND created_at <= ${end.toISOString()}
    `;
    return Number((rows[0] as any)?.count) || 0;
  }

  // For lead count within period
  if (metric === 'lead') {
    const { start, end } = getPeriodBoundaries();
    const rows = await sql`
      SELECT COUNT(*) as count FROM leads
      WHERE organization_id = ${organizationId}
      AND created_at >= ${start.toISOString()}
      AND created_at <= ${end.toISOString()}
    `;
    return Number((rows[0] as any)?.count) || 0;
  }

  // For other metrics, use the usage ledger
  return getCurrentUsage(organizationId, metric as UsageMetric);
}

/**
 * Get the limit value for a metric from tier limits.
 */
function getLimitForMetric(limits: TierLimits, metric: TierMetric): number {
  switch (metric) {
    case 'lead':
      return limits.monthly_lead_allowance;
    case 'campaign':
      return limits.campaigns;
    case 'sms':
      return limits.monthly_sms_allowance;
    case 'email':
      return limits.monthly_email_allowance ?? 1000; // Default for older plans
    case 'ai_request':
      return limits.ai_request_allowance;
    case 'automation':
      return limits.automation_limit;
    case 'workflow':
      return limits.workflow_limit;
    default:
      return -1; // Unlimited
  }
}

/**
 * Check if a usage action is allowed within tier limits.
 * Returns detailed information for UI display.
 */
export async function checkLimit(
  organizationId: string,
  metric: TierMetric,
  requestedAmount: number = 1
): Promise<LimitCheckResult> {
  const subscription = await getSubscription(organizationId);
  const limit = getLimitForMetric(subscription.limits, metric);
  const current = await getMetricUsage(organizationId, metric);

  // -1 means unlimited
  if (limit === -1) {
    return {
      allowed: true,
      current,
      limit: -1,
      remaining: Infinity,
      percentUsed: 0,
      tier: subscription.tier,
      isFreeTier: subscription.isFreeTier,
    };
  }

  const remaining = Math.max(0, limit - current);
  const wouldExceed = current + requestedAmount > limit;
  const percentUsed = limit > 0 ? Math.min(100, Math.round((current / limit) * 100)) : 0;

  const result: LimitCheckResult = {
    allowed: !wouldExceed,
    current,
    limit,
    remaining,
    percentUsed,
    tier: subscription.tier,
    isFreeTier: subscription.isFreeTier,
  };

  if (wouldExceed) {
    result.message = getExceededMessage(metric, subscription.isFreeTier);
    result.upgradeReason = getUpgradeReason(metric);
  } else if (percentUsed >= 80) {
    result.message = getApproachingMessage(metric, remaining, subscription.isFreeTier);
  }

  return result;
}

/**
 * Record usage for a metric.
 */
export async function recordMetricUsage(
  organizationId: string,
  metric: TierMetric,
  amount: number = 1
): Promise<void> {
  // For leads and campaigns, we track via actual table counts
  // but we still record to the ledger for analytics
  const { start, end } = getPeriodBoundaries();
  const id = `usage_${crypto.randomUUID().replace(/-/g, '')}`;

  await sql`
    INSERT INTO usage_ledger (
      id, organization_id, metric_type, amount, unit, period_start, period_end
    ) VALUES (
      ${id}, ${organizationId}, ${metric}, ${amount}, 'count',
      ${start.toISOString()}, ${end.toISOString()}
    )
  `;
}

/**
 * Get all usage metrics for an organization.
 */
export async function getUsageSummary(
  organizationId: string
): Promise<Record<TierMetric, LimitCheckResult>> {
  const metrics: TierMetric[] = ['lead', 'campaign', 'sms', 'email', 'ai_request'];
  const results: Record<string, LimitCheckResult> = {};

  for (const metric of metrics) {
    results[metric] = await checkLimit(organizationId, metric);
  }

  return results as Record<TierMetric, LimitCheckResult>;
}

// Helper functions for user-friendly messages

function getExceededMessage(metric: TierMetric, isFreeTier: boolean): string {
  const tierLabel = isFreeTier ? 'free plan' : 'current plan';

  switch (metric) {
    case 'lead':
      return `You've reached your ${tierLabel} limit for leads this month. Upgrade to add more leads.`;
    case 'campaign':
      return `You've reached your ${tierLabel} limit for campaigns. Upgrade for unlimited campaigns.`;
    case 'sms':
      return `You've used all your SMS messages for this month. Upgrade for more messaging capacity.`;
    case 'email':
      return `You've used all your email sends for this month. Upgrade for more email capacity.`;
    case 'ai_request':
      return `You've used all your AI requests for this month. Upgrade for more AI-powered features.`;
    default:
      return `You've reached your ${tierLabel} limit. Upgrade for more capacity.`;
  }
}

function getApproachingMessage(
  metric: TierMetric,
  remaining: number,
  isFreeTier: boolean
): string {
  const tierLabel = isFreeTier ? 'Free plan' : 'Plan';

  switch (metric) {
    case 'lead':
      return `${tierLabel}: ${remaining} lead${remaining === 1 ? '' : 's'} remaining this month.`;
    case 'campaign':
      return `${tierLabel}: ${remaining} campaign${remaining === 1 ? '' : 's'} remaining.`;
    case 'sms':
      return `${tierLabel}: ${remaining} SMS message${remaining === 1 ? '' : 's'} remaining.`;
    case 'email':
      return `${tierLabel}: ${remaining} email${remaining === 1 ? '' : 's'} remaining.`;
    case 'ai_request':
      return `${tierLabel}: ${remaining} AI request${remaining === 1 ? '' : 's'} remaining.`;
    default:
      return `${tierLabel}: ${remaining} remaining.`;
  }
}

function getUpgradeReason(metric: TierMetric): string {
  switch (metric) {
    case 'lead':
      return 'Starter plan includes 1,000 leads/month';
    case 'campaign':
      return 'Professional plan includes unlimited campaigns';
    case 'sms':
      return 'Starter plan includes 500 SMS/month';
    case 'email':
      return 'Starter plan includes 5,000 emails/month';
    case 'ai_request':
      return 'Starter plan includes 1,000 AI requests/month';
    default:
      return 'Upgrade for increased limits';
  }
}
