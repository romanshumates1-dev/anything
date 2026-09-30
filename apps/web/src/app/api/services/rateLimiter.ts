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
 * Legacy aliases for the per-window limit keys.
 *
 * DEFECT (2026-09-30): plan rows carry their AI allowance under two different
 * key names. `tierLimits.ts` and the sidebar read `ai_request_allowance`
 * (plan_free uses it), while this limiter read `daily_ai_requests` /
 * `weekly_ai_requests` / `monthly_ai_credits` (every other plan uses those).
 * For `plan_free` all three were `undefined`, and `Number(undefined) || 0`
 * turned the missing MONTHLY key into 0 — the only window not skipped — so
 * `check_rate_limit` denied the first request with
 * "You've used all 0 ai requests for this month", locking out every free/trial
 * organization from all AI.
 *
 * Resolution order per key: the window-specific key, then the plan's declared
 * monthly AI allowance. An EXPLICIT 0 in the window-specific key is preserved
 * (a deliberate "no AI on this plan"), and -1 (unlimited) always wins.
 */
const LEGACY_LIMIT_ALIASES: Record<string, string> = {
  daily_ai_requests: 'ai_request_allowance',
  weekly_ai_requests: 'ai_request_allowance',
  monthly_ai_credits: 'ai_request_allowance',
  daily_sms: 'ai_request_allowance',
  weekly_sms: 'ai_request_allowance',
  daily_emails: 'ai_request_allowance',
  weekly_emails: 'ai_request_allowance',
  monthly_sms_allowance: 'ai_request_allowance',
  monthly_email_allowance: 'ai_request_allowance',
};

/**
 * Resolve one limit value, tolerating the plan's alternate key spelling.
 * `undefined`/absent/NaN never becomes a silent 0: the alias is consulted, and
 * only if nothing is declared anywhere is the window skipped by the caller.
 */
export function resolveLimitValue(
  limits: Record<string, unknown>,
  key: string
): number | undefined {
  const raw = limits?.[key];
  if (raw !== undefined && raw !== null) {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  const alias = LEGACY_LIMIT_ALIASES[key];
  if (alias) {
    const aliasRaw = limits?.[alias];
    if (aliasRaw !== undefined && aliasRaw !== null) {
      const n = Number(aliasRaw);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

/**
 * Normalize a plan's limits JSONB so every window key this limiter reads has a
 * defined value. Exported for direct unit testing.
 */
export function getPlanLimitsForTest(
  limits: Record<string, unknown>
): Record<string, number> {
  const out: Record<string, number> = { ...(limits as Record<string, number>) };
  for (const key of Object.values(LIMIT_KEYS).flatMap((byPeriod) => Object.values(byPeriod))) {
    const resolved = resolveLimitValue(limits, key);
    if (resolved !== undefined) out[key] = resolved;
  }
  return out;
}

/**
 * Denial message. It must quote USAGE against the LIMIT: the previous text
 * printed the limit where it meant usage, which is how a limit of 0 produced
 * "You've used all 0 ai requests" for an account that had used nothing.
 */
export function buildRateLimitMessage(
  metric: string,
  period: RateLimitPeriod,
  currentUsage: number,
  limitValue: number,
  resetsAt: Date
): string {
  const cap = limitValue === -1 ? 'unlimited' : String(limitValue);
  return (
    `Rate limit exceeded: You've used all ${cap} ${metric.replace('_', ' ')}s ` +
    `for ${PERIOD_NAMES[period]} (${currentUsage} used). ` +
    `Resets at ${resetsAt.toLocaleString()}.`
  );
}

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

  // Normalize the plan's limits against this limiter's key names BEFORE any
  // window is evaluated. Without this, a plan that spells its allowance
  // `ai_request_allowance` (plan_free) resolved every AI window to undefined,
  // and the monthly window's `|| 0` denied every request (see the defect note
  // above resolveLimitValue).
  const normalizedLimits = row?.limits ? getPlanLimitsForTest(row.limits) : null;

  if (!row || !normalizedLimits) {
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
    limits: normalizedLimits,
    tier: row.tier,
    planName: row.plan_name,
    cooldownMinutes: Number(normalizedLimits.cooldown_minutes_after_limit) || 0,
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

  // Use the database function for atomic check-and-increment.
  // `organizationId` is passed as TEXT on purpose (defect #34): organization
  // ids are `org_<hex>` strings throughout the schema. The function used to
  // take uuid and this call cast to match, which made EVERY rate-limited
  // endpoint 500 for every real organization with
  // "invalid input syntax for type uuid: \"org_...\"". Migration 093 aligned
  // the column and function types to text; do not reintroduce the cast.
  const result = await sql`
    SELECT * FROM check_rate_limit(
      ${userId},
      ${organizationId},
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
      : buildRateLimitMessage(metric, period, Number(row.current_usage), row.limit_value, new Date(row.resets_at)),
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
    // resolveLimitValue tolerates the plan's alternate key spelling and
    // returns undefined (NOT 0) when the plan declares nothing for this
    // window, so an undeclared window is skipped rather than evaluated as a
    // zero cap. That distinction is the whole fix: a zero cap denies the
    // first request.
    const limitValue = resolveLimitValue(limits, limitKey);

    // Skip if no limit defined for this period
    if (limitValue === undefined || (limitValue === 0 && period !== 'monthly')) continue;

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
  const monthlyLimit = resolveLimitValue(limits, monthlyLimitKey);
  // An undeclared monthly window means "no monthly cap" — report the metric as
  // allowed with a zero limit rather than fabricating a cap of 0 (which the
  // status object would then render as "0 remaining").
  if (monthlyLimit === undefined) {
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
          ${organizationId},
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
