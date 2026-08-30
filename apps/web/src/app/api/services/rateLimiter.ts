/**
 * Rate Limiter Service — ChatGPT/Anthropic-style tiered rate limits
 *
 * Enforces daily, weekly, and monthly usage caps per subscription tier.
 * Similar to how ChatGPT limits messages per 3 hours and Anthropic limits
 * messages per day for different tiers.
 *
 * Usage:
 *   const result = await checkRateLimit(userId, orgId, 'ai_request');
 *   if (!result.allowed) {
 *     return Response.json({ error: result.message }, { status: 429 });
 *   }
 */
import sql from '@/app/api/utils/sql';

export type RateLimitMetric = 'ai_request' | 'sms' | 'email';
export type RateLimitPeriod = 'daily' | 'weekly' | 'monthly';

export interface RateLimitStatus {
  allowed: boolean;
  metric: RateLimitMetric;
  period: RateLimitPeriod;
  currentUsage: number;
  limit: number;
  remaining: number;
  resetsAt: Date;
  cooldownUntil?: Date;
  message?: string;
}

export interface RateLimitSummary {
  daily: {
    ai_request: RateLimitStatus;
    sms: RateLimitStatus;
    email: RateLimitStatus;
  };
  weekly: {
    ai_request: RateLimitStatus;
    sms: RateLimitStatus;
    email: RateLimitStatus;
  };
  monthly: {
    ai_request: RateLimitStatus;
    sms: RateLimitStatus;
    email: RateLimitStatus;
  };
  tier: string;
  planName: string;
}

// Map metric types to plan limit keys
const LIMIT_KEYS: Record<RateLimitMetric, Record<RateLimitPeriod, string>> = {
  ai_request: {
    daily: 'daily_ai_requests',
    weekly: 'weekly_ai_requests',
    monthly: 'monthly_ai_credits',
  },
  sms: {
    daily: 'daily_sms',
    weekly: 'weekly_sms',
    monthly: 'monthly_sms_allowance',
  },
  email: {
    daily: 'daily_emails',
    weekly: 'weekly_emails',
    monthly: 'monthly_email_allowance',
  },
};

// User-friendly period names
const PERIOD_NAMES: Record<RateLimitPeriod, string> = {
  daily: 'today',
  weekly: 'this week',
  monthly: 'this month',
};

/**
 * Get the user's subscription plan limits
 */
async function getPlanLimits(
  userId: string,
  organizationId?: string
): Promise<{ limits: Record<string, number>; tier: string; planName: string; cooldownMinutes: number }> {
  // Try org subscription first, then fall back to free tier
  const rows = await sql`
    SELECT
      p.limits,
      p.tier,
      p.name as plan_name
    FROM "user" u
    LEFT JOIN organization_members om ON om.user_id = u.id
    LEFT JOIN organization_subscriptions os ON os.organization_id = om.organization_id
      AND os.status IN ('active', 'trial')
    LEFT JOIN subscription_plans p ON p.id = COALESCE(os.plan_id, 'plan_free')
    WHERE u.id = ${userId}
    LIMIT 1
  `;

  const row = rows[0] as { limits: Record<string, number>; tier: string; plan_name: string } | undefined;

  if (!row || !row.limits) {
    // Default free tier limits
    return {
      limits: {
        daily_ai_requests: 5,
        daily_sms: 5,
        daily_emails: 25,
        weekly_ai_requests: 50,
        weekly_sms: 25,
        weekly_emails: 100,
        monthly_ai_credits: 50,
        monthly_sms_allowance: 0,
        monthly_email_allowance: 25,
        cooldown_minutes_after_limit: 60,
      },
      tier: 'free',
      planName: 'Free',
      cooldownMinutes: 60,
    };
  }

  return {
    limits: row.limits,
    tier: row.tier,
    planName: row.plan_name,
    cooldownMinutes: Number(row.limits.cooldown_minutes_after_limit) || 0,
  };
}

/**
 * Check rate limit for a specific metric and period
 */
async function checkSingleRateLimit(
  userId: string,
  organizationId: string | null,
  metric: RateLimitMetric,
  period: RateLimitPeriod,
  limitValue: number,
  increment: number = 1
): Promise<RateLimitStatus> {
  // -1 means unlimited
  if (limitValue === -1) {
    return {
      allowed: true,
      metric,
      period,
      currentUsage: 0,
      limit: -1,
      remaining: -1,
      resetsAt: new Date(),
    };
  }

  // Use the database function for atomic check-and-increment
  const result = await sql`
    SELECT * FROM check_rate_limit(
      ${userId},
      ${organizationId}::uuid,
      ${metric},
      ${period},
      ${limitValue},
      ${increment}
    )
  `;

  const row = result[0] as {
    allowed: boolean;
    current_usage: number;
    limit_value: number;
    remaining: number;
    resets_at: Date;
    cooldown_until: Date | null;
  };

  return {
    allowed: row.allowed,
    metric,
    period,
    currentUsage: row.current_usage,
    limit: row.limit_value,
    remaining: row.remaining,
    resetsAt: new Date(row.resets_at),
    cooldownUntil: row.cooldown_until ? new Date(row.cooldown_until) : undefined,
    message: row.allowed
      ? undefined
      : `Rate limit exceeded: You've used all ${row.limit_value} ${metric.replace('_', ' ')}s for ${PERIOD_NAMES[period]}. Resets at ${new Date(row.resets_at).toLocaleString()}.`,
  };
}

/**
 * Check all rate limits for a metric (daily, weekly, monthly)
 * Returns the most restrictive limit that's been hit
 */
export async function checkRateLimit(
  userId: string,
  organizationId: string | null,
  metric: RateLimitMetric,
  increment: number = 1
): Promise<RateLimitStatus> {
  const { limits, tier, planName, cooldownMinutes } = await getPlanLimits(userId, organizationId || undefined);

  // Enterprise tier - unlimited
  if (tier === 'enterprise') {
    return {
      allowed: true,
      metric,
      period: 'monthly',
      currentUsage: 0,
      limit: -1,
      remaining: -1,
      resetsAt: new Date(),
    };
  }

  // Check all periods, return first failure (most restrictive)
  const periods: RateLimitPeriod[] = ['daily', 'weekly', 'monthly'];

  for (const period of periods) {
    const limitKey = LIMIT_KEYS[metric][period];
    const limitValue = Number(limits[limitKey]) || 0;

    // Skip if no limit defined for this period
    if (limitValue === 0 && period !== 'monthly') continue;

    const status = await checkSingleRateLimit(
      userId,
      organizationId,
      metric,
      period,
      limitValue,
      increment
    );

    if (!status.allowed) {
      // Add cooldown info for blocked requests
      if (cooldownMinutes > 0 && status.cooldownUntil) {
        status.message = `${status.message} Cooldown period: ${cooldownMinutes} minutes.`;
      }
      return status;
    }
  }

  // All checks passed - return monthly status (most relevant for UI)
  const monthlyLimitKey = LIMIT_KEYS[metric]['monthly'];
  const monthlyLimit = Number(limits[monthlyLimitKey]) || 0;

  return checkSingleRateLimit(userId, organizationId, metric, 'monthly', monthlyLimit, 0);
}

/**
 * Get full rate limit summary for a user (for settings/dashboard display)
 */
export async function getRateLimitSummary(
  userId: string,
  organizationId?: string
): Promise<RateLimitSummary> {
  const { limits, tier, planName } = await getPlanLimits(userId, organizationId);

  const metrics: RateLimitMetric[] = ['ai_request', 'sms', 'email'];
  const periods: RateLimitPeriod[] = ['daily', 'weekly', 'monthly'];

  const summary: RateLimitSummary = {
    daily: {} as RateLimitSummary['daily'],
    weekly: {} as RateLimitSummary['weekly'],
    monthly: {} as RateLimitSummary['monthly'],
    tier,
    planName,
  };

  for (const period of periods) {
    for (const metric of metrics) {
      const limitKey = LIMIT_KEYS[metric][period];
      const limitValue = Number(limits[limitKey]) || 0;

      // Get current usage without incrementing
      const status = await checkSingleRateLimit(
        userId,
        organizationId || null,
        metric,
        period,
        limitValue,
        0 // Don't increment
      );

      summary[period][metric] = status;
    }
  }

  return summary;
}

/**
 * Record usage without checking limits (for background jobs that already checked)
 */
export async function recordRateLimitUsage(
  userId: string,
  organizationId: string | null,
  metric: RateLimitMetric,
  amount: number = 1
): Promise<void> {
  const { limits } = await getPlanLimits(userId, organizationId || undefined);

  const periods: RateLimitPeriod[] = ['daily', 'weekly', 'monthly'];

  for (const period of periods) {
    const limitKey = LIMIT_KEYS[metric][period];
    const limitValue = Number(limits[limitKey]) || 0;

    if (limitValue !== 0) {
      await sql`
        SELECT check_rate_limit(
          ${userId},
          ${organizationId}::uuid,
          ${metric},
          ${period},
          ${limitValue},
          ${amount}
        )
      `;
    }
  }
}

/**
 * Format rate limit error for API response
 */
export function formatRateLimitError(status: RateLimitStatus): {
  error: string;
  code: string;
  details: {
    metric: string;
    period: string;
    used: number;
    limit: number;
    remaining: number;
    resetsAt: string;
    cooldownUntil?: string;
  };
} {
  return {
    error: status.message || 'Rate limit exceeded',
    code: 'RATE_LIMIT_EXCEEDED',
    details: {
      metric: status.metric,
      period: status.period,
      used: status.currentUsage,
      limit: status.limit,
      remaining: status.remaining,
      resetsAt: status.resetsAt.toISOString(),
      cooldownUntil: status.cooldownUntil?.toISOString(),
    },
  };
}
