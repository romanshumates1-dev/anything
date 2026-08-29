/**
 * Subscription Enforcement Guard
 *
 * Checks if the organization has access to specific features based on their
 * subscription tier. Used by API routes to enforce paid feature access.
 */
import sql from './sql';

export type FeatureKey =
  | 'ai_classification'
  | 'ai_negotiation'
  | 'contract_generation'
  | 'buyer_matching'
  | 'api_access'
  | 'team_collaboration'
  | 'unlimited_leads'
  | 'unlimited_campaigns'
  | 'phone_support'
  | 'priority_support';

// Features available per tier
const TIER_FEATURES: Record<string, FeatureKey[]> = {
  free: [],
  starter: ['ai_classification'],
  pro: ['ai_classification', 'ai_negotiation', 'contract_generation', 'buyer_matching', 'priority_support'],
  business: ['ai_classification', 'ai_negotiation', 'contract_generation', 'buyer_matching', 'api_access', 'team_collaboration', 'unlimited_leads', 'unlimited_campaigns', 'phone_support', 'priority_support'],
  enterprise: ['ai_classification', 'ai_negotiation', 'contract_generation', 'buyer_matching', 'api_access', 'team_collaboration', 'unlimited_leads', 'unlimited_campaigns', 'phone_support', 'priority_support'],
};

interface SubscriptionStatus {
  tier: string;
  active: boolean;
  expiresAt: Date | null;
  limits: {
    monthly_ai_credits: number;
    monthly_lead_allowance: number;
    monthly_sms_allowance: number;
    campaigns: number;
    seats: number;
  };
}

interface UsageStatus {
  ai_credits_used: number;
  leads_count: number;
  sms_sent: number;
  campaigns_count: number;
}

interface GuardResult {
  allowed: boolean;
  reason?: string;
  tier: string;
  upgradeRequired?: boolean;
}

/**
 * Get organization's current subscription status.
 */
export async function getSubscriptionStatus(organizationId: string): Promise<SubscriptionStatus | null> {
  try {
    const [sub] = await sql`
      SELECT
        os.status,
        os.current_period_end,
        sp.tier,
        sp.limits
      FROM organization_subscriptions os
      JOIN subscription_plans sp ON sp.id = os.plan_id
      WHERE os.organization_id = ${organizationId}
      LIMIT 1
    `;

    if (!sub) {
      // Default to free tier if no subscription
      return {
        tier: 'free',
        active: true,
        expiresAt: null,
        limits: {
          monthly_ai_credits: 50,
          monthly_lead_allowance: 100,
          monthly_sms_allowance: 50,
          campaigns: 1,
          seats: 1,
        },
      };
    }

    const limits = sub.limits || {};
    return {
      tier: sub.tier || 'free',
      active: sub.status === 'active',
      expiresAt: sub.current_period_end ? new Date(sub.current_period_end) : null,
      limits: {
        monthly_ai_credits: limits.monthly_ai_credits ?? 50,
        monthly_lead_allowance: limits.monthly_lead_allowance ?? 100,
        monthly_sms_allowance: limits.monthly_sms_allowance ?? 50,
        campaigns: limits.campaigns ?? 1,
        seats: limits.seats ?? 1,
      },
    };
  } catch (error) {
    console.error('[SUBSCRIPTION] Failed to get status:', error);
    return null;
  }
}

/**
 * Get organization's current month usage.
 */
export async function getUsageStatus(organizationId: string): Promise<UsageStatus> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  try {
    const [[aiCredits], [leads], [sms], [campaigns]] = await Promise.all([
      sql`SELECT COALESCE(SUM(credits_used), 0) as total FROM ai_credit_usage WHERE organization_id = ${organizationId} AND created_at >= ${startOfMonth}`,
      sql`SELECT COUNT(*) as total FROM leads WHERE organization_id = ${organizationId}`,
      sql`SELECT COUNT(*) as total FROM message_events WHERE organization_id = ${organizationId} AND direction = 'outbound' AND created_at >= ${startOfMonth}`,
      sql`SELECT COUNT(*) as total FROM outreach_campaigns WHERE organization_id = ${organizationId} AND status != 'COMPLETED'`,
    ]);

    return {
      ai_credits_used: parseInt(aiCredits?.total || '0'),
      leads_count: parseInt(leads?.total || '0'),
      sms_sent: parseInt(sms?.total || '0'),
      campaigns_count: parseInt(campaigns?.total || '0'),
    };
  } catch (error) {
    console.error('[SUBSCRIPTION] Failed to get usage:', error);
    return { ai_credits_used: 0, leads_count: 0, sms_sent: 0, campaigns_count: 0 };
  }
}

/**
 * Check if organization has access to a specific feature.
 */
export async function checkFeatureAccess(
  organizationId: string,
  feature: FeatureKey
): Promise<GuardResult> {
  const sub = await getSubscriptionStatus(organizationId);

  if (!sub) {
    return { allowed: false, reason: 'No subscription found', tier: 'unknown', upgradeRequired: true };
  }

  if (!sub.active) {
    return { allowed: false, reason: 'Subscription expired', tier: sub.tier, upgradeRequired: true };
  }

  const tierFeatures = TIER_FEATURES[sub.tier] || [];
  if (!tierFeatures.includes(feature)) {
    return {
      allowed: false,
      reason: `Feature '${feature}' requires upgrade from ${sub.tier} tier`,
      tier: sub.tier,
      upgradeRequired: true,
    };
  }

  return { allowed: true, tier: sub.tier };
}

/**
 * Check if organization can perform an action based on usage limits.
 */
export async function checkUsageLimit(
  organizationId: string,
  limitType: 'ai_credits' | 'leads' | 'sms' | 'campaigns',
  amount: number = 1
): Promise<GuardResult> {
  const sub = await getSubscriptionStatus(organizationId);
  const usage = await getUsageStatus(organizationId);

  if (!sub) {
    return { allowed: false, reason: 'No subscription found', tier: 'unknown', upgradeRequired: true };
  }

  // -1 means unlimited
  switch (limitType) {
    case 'ai_credits':
      if (sub.limits.monthly_ai_credits === -1) return { allowed: true, tier: sub.tier };
      if (usage.ai_credits_used + amount > sub.limits.monthly_ai_credits) {
        return {
          allowed: false,
          reason: `AI credit limit reached (${usage.ai_credits_used}/${sub.limits.monthly_ai_credits})`,
          tier: sub.tier,
          upgradeRequired: true,
        };
      }
      break;

    case 'leads':
      if (sub.limits.monthly_lead_allowance === -1) return { allowed: true, tier: sub.tier };
      if (usage.leads_count + amount > sub.limits.monthly_lead_allowance) {
        return {
          allowed: false,
          reason: `Lead limit reached (${usage.leads_count}/${sub.limits.monthly_lead_allowance})`,
          tier: sub.tier,
          upgradeRequired: true,
        };
      }
      break;

    case 'sms':
      if (sub.limits.monthly_sms_allowance === -1) return { allowed: true, tier: sub.tier };
      if (usage.sms_sent + amount > sub.limits.monthly_sms_allowance) {
        return {
          allowed: false,
          reason: `SMS limit reached (${usage.sms_sent}/${sub.limits.monthly_sms_allowance})`,
          tier: sub.tier,
          upgradeRequired: true,
        };
      }
      break;

    case 'campaigns':
      if (sub.limits.campaigns === -1) return { allowed: true, tier: sub.tier };
      if (usage.campaigns_count + amount > sub.limits.campaigns) {
        return {
          allowed: false,
          reason: `Campaign limit reached (${usage.campaigns_count}/${sub.limits.campaigns})`,
          tier: sub.tier,
          upgradeRequired: true,
        };
      }
      break;
  }

  return { allowed: true, tier: sub.tier };
}

/**
 * Record AI credit usage.
 */
export async function recordAIUsage(
  organizationId: string,
  userId: string,
  operationType: string,
  credits: number = 1,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await sql`
      INSERT INTO ai_credit_usage (organization_id, user_id, operation_type, credits_used, metadata)
      VALUES (${organizationId}, ${userId}, ${operationType}, ${credits}, ${JSON.stringify(metadata || {})})
    `;
  } catch (error) {
    console.error('[SUBSCRIPTION] Failed to record AI usage:', error);
  }
}
