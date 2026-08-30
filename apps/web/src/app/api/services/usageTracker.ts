/**
 * Usage tracking service - enforce subscription limits.
 * 
 * Tracks and enforces limits for:
 * - SMS messages
 * - AI requests
 * - Storage
 * - API rate limits
 * - Automations and workflows
 */
import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';

export type UsageMetric = 'sms' | 'ai_request' | 'storage' | 'api_rate' | 'automation' | 'workflow';

export interface UsageLimit {
  limit: number;
  used: number;
  remaining: number;
  hardLimitReached: boolean;
  softLimitReached: boolean;
}

export interface UsageResult {
  allowed: boolean;
  limit: UsageLimit;
  message?: string;
}

// Soft limit threshold (80% of hard limit)
const SOFT_LIMIT_THRESHOLD = 0.8;

/**
 * Get current period boundaries (monthly)
 */
function getPeriodBoundaries(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

/**
 * Get the plan limit for a specific metric.
 */
export async function getPlanLimit(organizationId: string, metric: UsageMetric): Promise<number> {
  const rows = await sql`
    SELECT p.limits->${metric} as limit_value
    FROM organization_subscriptions os
    JOIN subscription_plans p ON p.id = os.plan_id
    WHERE os.organization_id = ${organizationId}
    AND os.status IN ('trial', 'active')
  `;
  
  const row = rows[0] as any;
  return Number(row?.limit_value) || 0;
}

/**
 * Get current usage for an organization in the current period.
 */
export async function getCurrentUsage(organizationId: string, metric: UsageMetric): Promise<number> {
  const { start, end } = getPeriodBoundaries();
  
  const rows = await sql`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM usage_ledger
    WHERE organization_id = ${organizationId}
    AND metric_type = ${metric}
    AND recorded_at >= ${start.toISOString()}
    AND recorded_at <= ${end.toISOString()}
  `;
  
  const row = rows[0] as any;
  return Number(row?.total) || 0;
}

/**
 * Check if usage is within limits.
 * Returns: whether the operation is allowed, limit details
 */
export async function checkUsageLimit(
  organizationId: string, 
  metric: UsageMetric,
  requestedAmount: number = 1
): Promise<UsageResult> {
  const limit = await getPlanLimit(organizationId, metric);
  const used = await getCurrentUsage(organizationId, metric);
  const remaining = Math.max(0, limit - used);
  
  const hardLimitReached = used + requestedAmount > limit;
  const softLimitReached = (used + requestedAmount) >= (limit * SOFT_LIMIT_THRESHOLD);
  
  // Check for Twilio 10DLC campaign status for SMS
  if (metric === 'sms') {
    const twilioRows = await sql`
      SELECT campaign_status FROM twilio_accounts WHERE organization_id = ${organizationId} LIMIT 1
    `;
    const twilio = twilioRows[0] as any;
    if (twilio?.campaign_status === 'pending') {
      return {
        allowed: false,
        limit: { limit, used, remaining, hardLimitReached, softLimitReached },
        message: 'SMS sending paused: Twilio 10DLC campaign pending approval'
      };
    }
  }
  
  return {
    allowed: !hardLimitReached,
    limit: { limit, used, remaining, hardLimitReached, softLimitReached }
  };
}

/**
 * Record usage for an organization.
 */
export async function recordUsage(
  organizationId: string,
  metric: UsageMetric,
  amount: number = 1
): Promise<void> {
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
  
  await logEvent('usage_recorded', 'organization', organizationId, {
    metric,
    amount
  });
}

/**
 * Get usage summary for an organization.
 */
export async function getUsageSummary(organizationId: string): Promise<Record<UsageMetric, UsageLimit>> {
  const metrics: UsageMetric[] = ['sms', 'ai_request', 'storage', 'api_rate', 'automation', 'workflow'];
  
  const results: Record<UsageMetric, UsageLimit> = {} as any;
  
  for (const metric of metrics) {
    const limitValue = await getPlanLimit(organizationId, metric);
    const used = await getCurrentUsage(organizationId, metric);
    
    results[metric] = {
      limit: limitValue,
      used,
      remaining: Math.max(0, limitValue - used),
      hardLimitReached: used >= limitValue,
      softLimitReached: used >= (limitValue * SOFT_LIMIT_THRESHOLD)
    };
  }
  
  return results;
}