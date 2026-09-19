/**
 * Usage Limits Helper - Convenience utilities for checking and managing usage limits.
 *
 * This is the primary entry point for API routes needing to check usage limits.
 * Provides a simpler interface than the full tierLimits service.
 *
 * Usage:
 *   import { checkUsageLimit, incrementUsage, getUsageSummary } from '@/app/api/utils/usageLimits';
 *
 *   // Check before creating a resource
 *   const { allowed, used, limit } = await checkUsageLimit(orgId, 'lead');
 *   if (!allowed) {
 *     return Response.json({ error: 'limit_exceeded', resource: 'lead', used, limit }, { status: 402 });
 *   }
 *
 *   // After creating, increment usage
 *   await incrementUsage(orgId, 'lead');
 */
import {
  checkLimit,
  recordMetricUsage,
  getUsageSummary as getFullUsageSummary,
  getSubscription,
  type TierMetric,
  type LimitCheckResult,
  type SubscriptionInfo,
} from '@/app/api/services/tierLimits';

export type ResourceType = 'lead' | 'campaign' | 'sms' | 'email' | 'ai_request';

export interface UsageLimitResult {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  percentUsed: number;
  isFreeTier: boolean;
  tier: string;
  message?: string;
  upgradeReason?: string;
}

export interface UsageSummary {
  lead: UsageLimitResult;
  campaign: UsageLimitResult;
  sms: UsageLimitResult;
  email: UsageLimitResult;
  ai_request: UsageLimitResult;
  subscription: {
    planId: string;
    planName: string;
    tier: string;
    isFreeTier: boolean;
  };
}

/**
 * Check if an organization can perform an action based on their usage limits.
 *
 * @param orgId - Organization ID
 * @param resource - Resource type to check ('lead', 'campaign', 'sms', 'email', 'ai_request')
 * @param amount - Number of resources to check (default: 1)
 * @returns Promise with allowed status and usage details
 *
 * @example
 * ```ts
 * const { allowed, used, limit } = await checkUsageLimit(orgId, 'lead');
 * if (!allowed) {
 *   return Response.json({
 *     error: 'limit_exceeded',
 *     resource: 'lead',
 *     used,
 *     limit,
 *   }, { status: 402 });
 * }
 * ```
 */
export async function checkUsageLimit(
  orgId: string,
  resource: ResourceType,
  amount: number = 1
): Promise<UsageLimitResult> {
  const result = await checkLimit(orgId, resource as TierMetric, amount);

  return {
    allowed: result.allowed,
    used: result.current,
    limit: result.limit,
    remaining: result.remaining,
    percentUsed: result.percentUsed,
    isFreeTier: result.isFreeTier,
    tier: result.tier,
    message: result.message,
    upgradeReason: result.upgradeReason,
  };
}

/**
 * Increment usage counter for a resource after successful creation.
 *
 * @param orgId - Organization ID
 * @param resource - Resource type that was created
 * @param amount - Number created (default: 1)
 *
 * @example
 * ```ts
 * // After successfully creating a lead
 * await incrementUsage(orgId, 'lead');
 * ```
 */
export async function incrementUsage(
  orgId: string,
  resource: ResourceType,
  amount: number = 1
): Promise<void> {
  await recordMetricUsage(orgId, resource as TierMetric, amount);
}

/**
 * Get a complete usage summary for all resources.
 * Useful for displaying usage dashboards.
 *
 * @param orgId - Organization ID
 * @returns Promise with usage for all resource types and subscription info
 *
 * @example
 * ```ts
 * const summary = await getUsageSummary(orgId);
 * // {
 * //   lead: { allowed: true, used: 3, limit: 10, ... },
 * //   campaign: { allowed: true, used: 1, limit: 1, ... },
 * //   ...
 * //   subscription: { planName: 'Free', tier: 'free', isFreeTier: true }
 * // }
 * ```
 */
export async function getUsageSummary(orgId: string): Promise<UsageSummary> {
  const [usage, subscription] = await Promise.all([
    getFullUsageSummary(orgId),
    getSubscription(orgId),
  ]);

  const mapResult = (r: LimitCheckResult): UsageLimitResult => ({
    allowed: r.allowed,
    used: r.current,
    limit: r.limit,
    remaining: r.remaining,
    percentUsed: r.percentUsed,
    isFreeTier: r.isFreeTier,
    tier: r.tier,
    message: r.message,
    upgradeReason: r.upgradeReason,
  });

  return {
    lead: mapResult(usage.lead),
    campaign: mapResult(usage.campaign),
    sms: mapResult(usage.sms),
    email: mapResult(usage.email),
    ai_request: mapResult(usage.ai_request),
    subscription: {
      planId: subscription.planId,
      planName: subscription.planName,
      tier: subscription.tier,
      isFreeTier: subscription.isFreeTier,
    },
  };
}

/**
 * Check if an organization is on the free tier.
 *
 * @param orgId - Organization ID
 * @returns Promise<boolean> - true if on free tier
 */
export async function isFreeTier(orgId: string): Promise<boolean> {
  const subscription = await getSubscription(orgId);
  return subscription.isFreeTier;
}

/**
 * Get the current subscription tier for an organization.
 *
 * @param orgId - Organization ID
 * @returns Promise with subscription details
 */
export async function getSubscriptionInfo(
  orgId: string
): Promise<SubscriptionInfo> {
  return getSubscription(orgId);
}

/**
 * Format a 402 Payment Required response for limit exceeded errors.
 * Provides a consistent response format across all API routes.
 *
 * @param resource - The resource type that exceeded limits
 * @param result - The usage limit check result
 * @returns Response object with proper format
 *
 * @example
 * ```ts
 * const result = await checkUsageLimit(orgId, 'lead');
 * if (!result.allowed) {
 *   return limitExceededResponse('lead', result);
 * }
 * ```
 */
export function limitExceededResponse(
  resource: ResourceType,
  result: UsageLimitResult
): Response {
  return Response.json(
    {
      error: 'limit_exceeded',
      resource,
      used: result.used,
      limit: result.limit,
      message: result.message,
      upgradeReason: result.upgradeReason,
      isFreeTier: result.isFreeTier,
      tier: result.tier,
    },
    { status: 402 }
  );
}
