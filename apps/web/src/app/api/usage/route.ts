/**
 * Usage API - Get current usage and limits for the organization.
 *
 * GET /api/usage - Returns all usage metrics with limits
 *
 * Response includes:
 * - Current usage for each metric
 * - Plan limits
 * - Percentage used
 * - Whether user is on free tier
 * - Upgrade messaging when approaching limits
 */
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { getOrganization } from '@/lib/organization-context';
import {
  getSubscription,
  getUsageSummary,
  type SubscriptionInfo,
  type LimitCheckResult,
  type TierMetric,
} from '@/app/api/services/tierLimits';

export interface UsageResponse {
  subscription: SubscriptionInfo;
  usage: Record<TierMetric, LimitCheckResult>;
  isFreeTier: boolean;
  showUpgradePrompt: boolean;
  upgradePromptType?: 'approaching_limit' | 'at_limit' | 'trial_ending';
  trialDaysRemaining?: number;
}

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const org = await getOrganization();
    if (!org) {
      return Response.json({ error: 'No organization found' }, { status: 404 });
    }

    const subscription = await getSubscription(org.id);
    const usage = await getUsageSummary(org.id);

    // Determine if we should show upgrade prompts
    let showUpgradePrompt = false;
    let upgradePromptType: UsageResponse['upgradePromptType'];

    // Check if any metric is at or near limit
    const usageEntries = Object.entries(usage) as [TierMetric, LimitCheckResult][];
    const atLimit = usageEntries.some(([_, u]) => !u.allowed && u.limit !== -1);
    const nearLimit = usageEntries.some(
      ([_, u]) => u.percentUsed >= 80 && u.limit !== -1
    );

    if (atLimit) {
      showUpgradePrompt = true;
      upgradePromptType = 'at_limit';
    } else if (nearLimit) {
      showUpgradePrompt = true;
      upgradePromptType = 'approaching_limit';
    }

    // Check trial status
    if (
      subscription.status === 'trial' &&
      subscription.daysRemaining !== undefined &&
      subscription.daysRemaining <= 3
    ) {
      showUpgradePrompt = true;
      upgradePromptType = 'trial_ending';
    }

    const response: UsageResponse = {
      subscription,
      usage,
      isFreeTier: subscription.isFreeTier,
      showUpgradePrompt,
      upgradePromptType,
      trialDaysRemaining: subscription.daysRemaining,
    };

    return Response.json(response);
  } catch (error) {
    console.error('GET /api/usage error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
