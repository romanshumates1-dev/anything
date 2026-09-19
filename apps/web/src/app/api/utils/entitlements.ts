/**
 * Entitlements System
 *
 * Manages feature access, tier limits, and usage enforcement.
 * Works alongside the credit system to provide comprehensive
 * access control for the platform.
 *
 * FEATURES:
 * - Tier-based feature gating
 * - Usage limits with soft/hard enforcement
 * - Rate limiting integration
 * - Audit logging for compliance
 */
import sql from './sql';
import { logEvent } from './logger';

/**
 * Subscription tiers in order of capability
 */
export type SubscriptionTier = 'FREE' | 'STARTER' | 'PRO' | 'ENTERPRISE';

/**
 * Features that can be gated by tier
 */
export type Feature =
  | 'campaigns'
  | 'ai_negotiation'
  | 'bulk_sms'
  | 'bulk_email'
  | 'contract_generation'
  | 'lead_finder'
  | 'advanced_analytics'
  | 'api_access'
  | 'team_members'
  | 'custom_branding'
  | 'priority_support'
  | 'webhook_integrations'
  | 'csv_export'
  | 'crm_integrations';

/**
 * Resources that have usage limits
 */
export type LimitedResource =
  | 'campaigns_per_month'
  | 'leads_per_month'
  | 'sms_per_day'
  | 'emails_per_day'
  | 'ai_requests_per_day'
  | 'team_members'
  | 'active_campaigns'
  | 'contacts'
  | 'api_calls_per_minute';

/**
 * Tier limits configuration
 */
export interface TierLimits {
  tier: SubscriptionTier;
  features: Feature[];
  limits: Record<LimitedResource, number>;
  creditMultiplier: number; // Cost multiplier (1.0 = base, 0.8 = 20% discount)
}

/**
 * Result of an entitlement check
 */
export interface EntitlementResult {
  allowed: boolean;
  reason?: string;
  tier: SubscriptionTier;
  upgradeRequired?: SubscriptionTier;
}

/**
 * Result of a limit check
 */
export interface LimitCheckResult {
  allowed: boolean;
  current: number;
  limit: number;
  remaining: number;
  resetAt?: Date;
  softLimitReached?: boolean;
}

/**
 * Default tier configurations
 * These are fallbacks if not configured in the database
 */
const DEFAULT_TIER_CONFIGS: Record<SubscriptionTier, TierLimits> = {
  FREE: {
    tier: 'FREE',
    features: ['campaigns', 'csv_export'],
    limits: {
      campaigns_per_month: 2,
      leads_per_month: 50,
      sms_per_day: 10,
      emails_per_day: 25,
      ai_requests_per_day: 5,
      team_members: 1,
      active_campaigns: 1,
      contacts: 100,
      api_calls_per_minute: 10,
    },
    creditMultiplier: 1.5, // 50% surcharge
  },
  STARTER: {
    tier: 'STARTER',
    features: [
      'campaigns',
      'bulk_email',
      'lead_finder',
      'csv_export',
      'crm_integrations',
    ],
    limits: {
      campaigns_per_month: 10,
      leads_per_month: 500,
      sms_per_day: 100,
      emails_per_day: 500,
      ai_requests_per_day: 50,
      team_members: 3,
      active_campaigns: 3,
      contacts: 1000,
      api_calls_per_minute: 30,
    },
    creditMultiplier: 1.2, // 20% surcharge
  },
  PRO: {
    tier: 'PRO',
    features: [
      'campaigns',
      'ai_negotiation',
      'bulk_sms',
      'bulk_email',
      'contract_generation',
      'lead_finder',
      'advanced_analytics',
      'api_access',
      'team_members',
      'csv_export',
      'webhook_integrations',
      'crm_integrations',
    ],
    limits: {
      campaigns_per_month: 50,
      leads_per_month: 5000,
      sms_per_day: 1000,
      emails_per_day: 5000,
      ai_requests_per_day: 500,
      team_members: 10,
      active_campaigns: 10,
      contacts: 10000,
      api_calls_per_minute: 100,
    },
    creditMultiplier: 1.0, // Base price
  },
  ENTERPRISE: {
    tier: 'ENTERPRISE',
    features: [
      'campaigns',
      'ai_negotiation',
      'bulk_sms',
      'bulk_email',
      'contract_generation',
      'lead_finder',
      'advanced_analytics',
      'api_access',
      'team_members',
      'custom_branding',
      'priority_support',
      'webhook_integrations',
      'csv_export',
      'crm_integrations',
    ],
    limits: {
      campaigns_per_month: -1, // Unlimited
      leads_per_month: -1,
      sms_per_day: 10000,
      emails_per_day: 50000,
      ai_requests_per_day: 5000,
      team_members: -1,
      active_campaigns: -1,
      contacts: -1,
      api_calls_per_minute: 500,
    },
    creditMultiplier: 0.8, // 20% discount
  },
};

/**
 * Get the subscription tier for an organization
 */
export async function getOrganizationTier(organizationId: string): Promise<SubscriptionTier> {
  try {
    const [result] = await sql`
      SELECT
        COALESCE(s.tier, 'FREE') as tier
      FROM organizations o
      LEFT JOIN subscriptions s ON s.organization_id = o.id AND s.status = 'ACTIVE'
      WHERE o.id = ${organizationId}
    `;

    if (!result) {
      return 'FREE';
    }

    const tier = (result.tier || 'FREE').toUpperCase() as SubscriptionTier;
    return tier in DEFAULT_TIER_CONFIGS ? tier : 'FREE';
  } catch (error) {
    console.error('[ENTITLEMENTS] Failed to get org tier:', error);
    return 'FREE';
  }
}

/**
 * Get tier limits configuration
 * Attempts to load from database, falls back to defaults
 */
export async function getTierLimits(tier: string): Promise<TierLimits> {
  const normalizedTier = tier.toUpperCase() as SubscriptionTier;

  try {
    // Try to load from database
    const [dbConfig] = await sql`
      SELECT features, limits, credit_multiplier
      FROM tier_configurations
      WHERE tier = ${normalizedTier}
    `;

    if (dbConfig) {
      return {
        tier: normalizedTier,
        features: dbConfig.features || [],
        limits: dbConfig.limits || {},
        creditMultiplier: dbConfig.credit_multiplier ?? 1.0,
      };
    }
  } catch {
    // Table may not exist, use defaults
  }

  // Fall back to defaults
  return DEFAULT_TIER_CONFIGS[normalizedTier] || DEFAULT_TIER_CONFIGS.FREE;
}

/**
 * Check if an organization has access to a specific feature
 */
export async function checkEntitlement(
  organizationId: string,
  feature: Feature
): Promise<EntitlementResult> {
  const tier = await getOrganizationTier(organizationId);
  const tierLimits = await getTierLimits(tier);

  const hasFeature = tierLimits.features.includes(feature);

  if (hasFeature) {
    return {
      allowed: true,
      tier,
    };
  }

  // Find minimum tier that has this feature
  const tierOrder: SubscriptionTier[] = ['FREE', 'STARTER', 'PRO', 'ENTERPRISE'];
  let upgradeRequired: SubscriptionTier | undefined;

  for (const checkTier of tierOrder) {
    const checkLimits = await getTierLimits(checkTier);
    if (checkLimits.features.includes(feature)) {
      upgradeRequired = checkTier;
      break;
    }
  }

  return {
    allowed: false,
    reason: `Feature '${feature}' requires ${upgradeRequired || 'ENTERPRISE'} tier`,
    tier,
    upgradeRequired,
  };
}

/**
 * Check if an organization has access to multiple features
 */
export async function checkEntitlements(
  organizationId: string,
  features: Feature[]
): Promise<Record<Feature, EntitlementResult>> {
  const results: Record<string, EntitlementResult> = {};

  // Get tier once for efficiency
  const tier = await getOrganizationTier(organizationId);
  const tierLimits = await getTierLimits(tier);

  for (const feature of features) {
    if (tierLimits.features.includes(feature)) {
      results[feature] = { allowed: true, tier };
    } else {
      // Find minimum required tier
      const tierOrder: SubscriptionTier[] = ['FREE', 'STARTER', 'PRO', 'ENTERPRISE'];
      let upgradeRequired: SubscriptionTier | undefined;

      for (const checkTier of tierOrder) {
        const checkLimits = DEFAULT_TIER_CONFIGS[checkTier];
        if (checkLimits.features.includes(feature)) {
          upgradeRequired = checkTier;
          break;
        }
      }

      results[feature] = {
        allowed: false,
        reason: `Feature '${feature}' requires ${upgradeRequired || 'ENTERPRISE'} tier`,
        tier,
        upgradeRequired,
      };
    }
  }

  return results as Record<Feature, EntitlementResult>;
}

/**
 * Get current usage for a limited resource
 */
async function getCurrentUsage(
  organizationId: string,
  resource: LimitedResource
): Promise<{ count: number; periodStart: Date }> {
  const now = new Date();
  let periodStart: Date;
  let count = 0;

  // Determine period based on resource type
  if (resource.includes('per_month')) {
    periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (resource.includes('per_day')) {
    periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (resource.includes('per_minute')) {
    periodStart = new Date(now.getTime() - 60 * 1000);
  } else {
    // Lifetime/current count
    periodStart = new Date(0);
  }

  try {
    // Resource-specific counting logic
    switch (resource) {
      case 'campaigns_per_month':
        const [campaignsResult] = await sql`
          SELECT COUNT(*) as count
          FROM campaigns
          WHERE organization_id = ${organizationId}
            AND created_at >= ${periodStart}
        `;
        count = Number(campaignsResult?.count || 0);
        break;

      case 'leads_per_month':
        const [leadsResult] = await sql`
          SELECT COUNT(*) as count
          FROM leads
          WHERE organization_id = ${organizationId}
            AND created_at >= ${periodStart}
        `;
        count = Number(leadsResult?.count || 0);
        break;

      case 'sms_per_day':
        const [smsResult] = await sql`
          SELECT COUNT(*) as count
          FROM outreach_messages
          WHERE organization_id = ${organizationId}
            AND channel = 'SMS'
            AND sent_at >= ${periodStart}
        `;
        count = Number(smsResult?.count || 0);
        break;

      case 'emails_per_day':
        const [emailResult] = await sql`
          SELECT COUNT(*) as count
          FROM outreach_messages
          WHERE organization_id = ${organizationId}
            AND channel = 'EMAIL'
            AND sent_at >= ${periodStart}
        `;
        count = Number(emailResult?.count || 0);
        break;

      case 'ai_requests_per_day':
        const [aiResult] = await sql`
          SELECT COUNT(*) as count
          FROM ai_requests
          WHERE organization_id = ${organizationId}
            AND created_at >= ${periodStart}
        `;
        count = Number(aiResult?.count || 0);
        break;

      case 'team_members':
        const [teamResult] = await sql`
          SELECT COUNT(*) as count
          FROM organization_members
          WHERE organization_id = ${organizationId}
        `;
        count = Number(teamResult?.count || 0);
        break;

      case 'active_campaigns':
        const [activeResult] = await sql`
          SELECT COUNT(*) as count
          FROM campaigns
          WHERE organization_id = ${organizationId}
            AND status IN ('ACTIVE', 'RUNNING', 'PAUSED')
        `;
        count = Number(activeResult?.count || 0);
        break;

      case 'contacts':
        const [contactsResult] = await sql`
          SELECT COUNT(*) as count
          FROM contacts
          WHERE organization_id = ${organizationId}
        `;
        count = Number(contactsResult?.count || 0);
        break;

      case 'api_calls_per_minute':
        const [apiResult] = await sql`
          SELECT COUNT(*) as count
          FROM api_request_logs
          WHERE organization_id = ${organizationId}
            AND timestamp >= ${periodStart}
        `;
        count = Number(apiResult?.count || 0);
        break;
    }
  } catch (error) {
    // Table may not exist, return 0
    console.warn(`[ENTITLEMENTS] Could not get usage for ${resource}:`, error);
  }

  return { count, periodStart };
}

/**
 * Check if organization is within limits for a resource
 */
export async function checkLimit(
  organizationId: string,
  resource: LimitedResource
): Promise<LimitCheckResult> {
  const tier = await getOrganizationTier(organizationId);
  const tierLimits = await getTierLimits(tier);
  const limit = tierLimits.limits[resource] ?? 0;

  // -1 means unlimited
  if (limit === -1) {
    return {
      allowed: true,
      current: 0,
      limit: -1,
      remaining: -1,
    };
  }

  const { count, periodStart } = await getCurrentUsage(organizationId, resource);
  const remaining = Math.max(0, limit - count);

  // Calculate reset time
  let resetAt: Date | undefined;
  if (resource.includes('per_month')) {
    resetAt = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, 1);
  } else if (resource.includes('per_day')) {
    resetAt = new Date(periodStart.getTime() + 24 * 60 * 60 * 1000);
  } else if (resource.includes('per_minute')) {
    resetAt = new Date(periodStart.getTime() + 60 * 1000);
  }

  // Soft limit at 80%
  const softLimitThreshold = Math.floor(limit * 0.8);
  const softLimitReached = count >= softLimitThreshold;

  return {
    allowed: count < limit,
    current: count,
    limit,
    remaining,
    resetAt,
    softLimitReached,
  };
}

/**
 * Enforce a limit - throws if limit exceeded
 * Use this before performing an action that consumes a limited resource
 */
export async function enforceLimit(
  organizationId: string,
  resource: LimitedResource,
  amount: number = 1
): Promise<void> {
  const check = await checkLimit(organizationId, resource);

  if (!check.allowed) {
    await logEvent('limit_exceeded', 'entitlements', organizationId, {
      resource,
      current: check.current,
      limit: check.limit,
      attempted: amount,
    });

    const tier = await getOrganizationTier(organizationId);
    throw new LimitExceededError(
      resource,
      check.current,
      check.limit,
      tier,
      check.resetAt
    );
  }

  if (check.remaining < amount) {
    await logEvent('limit_exceeded', 'entitlements', organizationId, {
      resource,
      current: check.current,
      limit: check.limit,
      attempted: amount,
      remaining: check.remaining,
    });

    const tier = await getOrganizationTier(organizationId);
    throw new LimitExceededError(
      resource,
      check.current,
      check.limit,
      tier,
      check.resetAt
    );
  }

  // Log soft limit warning
  if (check.softLimitReached) {
    await logEvent('soft_limit_reached', 'entitlements', organizationId, {
      resource,
      current: check.current,
      limit: check.limit,
      remaining: check.remaining,
    });
  }
}

/**
 * Enforce a feature entitlement - throws if not allowed
 */
export async function enforceEntitlement(
  organizationId: string,
  feature: Feature
): Promise<void> {
  const result = await checkEntitlement(organizationId, feature);

  if (!result.allowed) {
    await logEvent('feature_denied', 'entitlements', organizationId, {
      feature,
      tier: result.tier,
      upgradeRequired: result.upgradeRequired,
    });

    throw new FeatureNotAllowedError(
      feature,
      result.tier,
      result.upgradeRequired
    );
  }
}

/**
 * Combined check: feature entitlement + usage limit
 */
export async function checkAccess(
  organizationId: string,
  feature: Feature,
  resource?: LimitedResource,
  amount?: number
): Promise<{
  allowed: boolean;
  featureAllowed: boolean;
  limitAllowed: boolean;
  details: {
    feature?: EntitlementResult;
    limit?: LimitCheckResult;
  };
}> {
  const featureResult = await checkEntitlement(organizationId, feature);
  let limitResult: LimitCheckResult | undefined;

  if (resource) {
    limitResult = await checkLimit(organizationId, resource);
    if (amount && limitResult.remaining < amount) {
      limitResult.allowed = false;
    }
  }

  return {
    allowed: featureResult.allowed && (limitResult?.allowed ?? true),
    featureAllowed: featureResult.allowed,
    limitAllowed: limitResult?.allowed ?? true,
    details: {
      feature: featureResult,
      limit: limitResult,
    },
  };
}

/**
 * Get all limits and current usage for an organization
 */
export async function getUsageSummary(organizationId: string): Promise<{
  tier: SubscriptionTier;
  limits: Record<LimitedResource, LimitCheckResult>;
  features: Feature[];
}> {
  const tier = await getOrganizationTier(organizationId);
  const tierLimits = await getTierLimits(tier);

  const limits: Record<string, LimitCheckResult> = {};
  const resources: LimitedResource[] = [
    'campaigns_per_month',
    'leads_per_month',
    'sms_per_day',
    'emails_per_day',
    'ai_requests_per_day',
    'team_members',
    'active_campaigns',
    'contacts',
  ];

  for (const resource of resources) {
    limits[resource] = await checkLimit(organizationId, resource);
  }

  return {
    tier,
    limits: limits as Record<LimitedResource, LimitCheckResult>,
    features: tierLimits.features,
  };
}

/**
 * Custom error for limit exceeded
 */
export class LimitExceededError extends Error {
  public readonly resource: LimitedResource;
  public readonly current: number;
  public readonly limit: number;
  public readonly tier: SubscriptionTier;
  public readonly resetAt?: Date;
  public readonly code = 'LIMIT_EXCEEDED';

  constructor(
    resource: LimitedResource,
    current: number,
    limit: number,
    tier: SubscriptionTier,
    resetAt?: Date
  ) {
    const message = `Limit exceeded for ${resource}: ${current}/${limit} (tier: ${tier})`;
    super(message);
    this.name = 'LimitExceededError';
    this.resource = resource;
    this.current = current;
    this.limit = limit;
    this.tier = tier;
    this.resetAt = resetAt;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      resource: this.resource,
      current: this.current,
      limit: this.limit,
      tier: this.tier,
      resetAt: this.resetAt?.toISOString(),
    };
  }
}

/**
 * Custom error for feature not allowed
 */
export class FeatureNotAllowedError extends Error {
  public readonly feature: Feature;
  public readonly tier: SubscriptionTier;
  public readonly upgradeRequired?: SubscriptionTier;
  public readonly code = 'FEATURE_NOT_ALLOWED';

  constructor(
    feature: Feature,
    tier: SubscriptionTier,
    upgradeRequired?: SubscriptionTier
  ) {
    const message = upgradeRequired
      ? `Feature '${feature}' requires ${upgradeRequired} tier (current: ${tier})`
      : `Feature '${feature}' is not available on ${tier} tier`;
    super(message);
    this.name = 'FeatureNotAllowedError';
    this.feature = feature;
    this.tier = tier;
    this.upgradeRequired = upgradeRequired;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      feature: this.feature,
      tier: this.tier,
      upgradeRequired: this.upgradeRequired,
    };
  }
}

/**
 * Atomically increment usage and check limit in one operation.
 * Prevents race conditions where multiple requests check-then-increment.
 *
 * BULLETPROOF FEATURES:
 * - Atomic check + increment (no TOCTOU race)
 * - Row locking prevents concurrent modifications
 * - Returns false if limit would be exceeded
 */
export async function atomicIncrementUsage(
  organizationId: string,
  resource: LimitedResource,
  amount: number = 1
): Promise<{
  success: boolean;
  newCount: number;
  limit: number;
  remaining: number;
}> {
  const tier = await getOrganizationTier(organizationId);
  const tierLimits = await getTierLimits(tier);
  const limit = tierLimits.limits[resource] ?? 0;

  // -1 means unlimited
  if (limit === -1) {
    return {
      success: true,
      newCount: 0,
      limit: -1,
      remaining: -1,
    };
  }

  try {
    // Atomic increment with limit check
    const [result] = await sql`
      INSERT INTO usage_counters (organization_id, resource, count, period_start)
      VALUES (
        ${organizationId},
        ${resource},
        ${amount},
        ${getPeriodStart(resource)}
      )
      ON CONFLICT (organization_id, resource, period_start)
      DO UPDATE SET
        count = CASE
          WHEN usage_counters.count + ${amount} <= ${limit}
          THEN usage_counters.count + ${amount}
          ELSE usage_counters.count
        END,
        updated_at = NOW()
      WHERE usage_counters.count + ${amount} <= ${limit}
      RETURNING count
    `;

    if (!result) {
      // Limit exceeded - get current count
      const { count } = await getCurrentUsage(organizationId, resource);
      return {
        success: false,
        newCount: count,
        limit,
        remaining: Math.max(0, limit - count),
      };
    }

    return {
      success: true,
      newCount: result.count,
      limit,
      remaining: Math.max(0, limit - result.count),
    };
  } catch (error) {
    // Table may not exist, fall back to non-atomic check
    console.warn('[ENTITLEMENTS] Atomic increment failed, using fallback:', error);
    const check = await checkLimit(organizationId, resource);
    return {
      success: check.remaining >= amount,
      newCount: check.current + (check.remaining >= amount ? amount : 0),
      limit: check.limit,
      remaining: check.remaining - (check.remaining >= amount ? amount : 0),
    };
  }
}

/**
 * Get the period start date for a resource type
 */
function getPeriodStart(resource: LimitedResource): Date {
  const now = new Date();
  if (resource.includes('per_month')) {
    return new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (resource.includes('per_day')) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (resource.includes('per_minute')) {
    return new Date(Math.floor(now.getTime() / 60000) * 60000);
  }
  // Lifetime
  return new Date(0);
}

/**
 * Bulk check entitlements for multiple features and resources.
 * More efficient than calling individual checks.
 */
export async function bulkCheckAccess(
  organizationId: string,
  checks: Array<{
    feature: Feature;
    resource?: LimitedResource;
    amount?: number;
  }>
): Promise<{
  allAllowed: boolean;
  results: Array<{
    feature: Feature;
    resource?: LimitedResource;
    allowed: boolean;
    reason?: string;
  }>;
}> {
  const tier = await getOrganizationTier(organizationId);
  const tierLimits = await getTierLimits(tier);

  const results: Array<{
    feature: Feature;
    resource?: LimitedResource;
    allowed: boolean;
    reason?: string;
  }> = [];

  let allAllowed = true;

  for (const check of checks) {
    const featureAllowed = tierLimits.features.includes(check.feature);

    if (!featureAllowed) {
      allAllowed = false;
      results.push({
        feature: check.feature,
        resource: check.resource,
        allowed: false,
        reason: `Feature '${check.feature}' not available on ${tier} tier`,
      });
      continue;
    }

    if (check.resource) {
      const limitCheck = await checkLimit(organizationId, check.resource);
      const limitAllowed = limitCheck.remaining >= (check.amount || 1);

      if (!limitAllowed) {
        allAllowed = false;
        results.push({
          feature: check.feature,
          resource: check.resource,
          allowed: false,
          reason: `Limit exceeded for ${check.resource}: ${limitCheck.current}/${limitCheck.limit}`,
        });
        continue;
      }
    }

    results.push({
      feature: check.feature,
      resource: check.resource,
      allowed: true,
    });
  }

  return { allAllowed, results };
}

/**
 * Get upgrade path recommendations for an organization.
 * Returns features/limits that would be unlocked at each higher tier.
 */
export async function getUpgradeRecommendations(organizationId: string): Promise<{
  currentTier: SubscriptionTier;
  recommendations: Array<{
    tier: SubscriptionTier;
    newFeatures: Feature[];
    improvedLimits: Array<{
      resource: LimitedResource;
      current: number;
      new: number;
    }>;
  }>;
}> {
  const currentTier = await getOrganizationTier(organizationId);
  const currentLimits = await getTierLimits(currentTier);
  const tierOrder: SubscriptionTier[] = ['FREE', 'STARTER', 'PRO', 'ENTERPRISE'];
  const currentIndex = tierOrder.indexOf(currentTier);

  const recommendations: Array<{
    tier: SubscriptionTier;
    newFeatures: Feature[];
    improvedLimits: Array<{
      resource: LimitedResource;
      current: number;
      new: number;
    }>;
  }> = [];

  for (let i = currentIndex + 1; i < tierOrder.length; i++) {
    const upgradeTier = tierOrder[i];
    const upgradeLimits = await getTierLimits(upgradeTier);

    const newFeatures = upgradeLimits.features.filter(
      f => !currentLimits.features.includes(f)
    );

    const improvedLimits: Array<{
      resource: LimitedResource;
      current: number;
      new: number;
    }> = [];

    for (const [resource, newLimit] of Object.entries(upgradeLimits.limits)) {
      const currentLimit = currentLimits.limits[resource as LimitedResource] ?? 0;
      if (newLimit > currentLimit || (newLimit === -1 && currentLimit !== -1)) {
        improvedLimits.push({
          resource: resource as LimitedResource,
          current: currentLimit,
          new: newLimit,
        });
      }
    }

    if (newFeatures.length > 0 || improvedLimits.length > 0) {
      recommendations.push({
        tier: upgradeTier,
        newFeatures,
        improvedLimits,
      });
    }
  }

  return { currentTier, recommendations };
}
