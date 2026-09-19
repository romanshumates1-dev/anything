/**
 * Credits API - GET balance and costs
 *
 * Returns the organization's current credit balance and
 * tier-specific costs for all actions.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { getOrganization } from '@/lib/organization-context';
import {
  getBalanceDetails,
  getAllCosts,
  getTransactionHistory,
} from '@/app/api/utils/credits';
import { getSubscriptionStatus } from '@/app/api/utils/subscriptionGuard';

export interface CreditsResponse {
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

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const organization = await getOrganization();
  if (!organization) {
    return NextResponse.json({ error: 'No organization' }, { status: 403 });
  }

  const url = new URL(req.url);
  const includeHistory = url.searchParams.get('history') === 'true';
  const historyLimit = parseInt(url.searchParams.get('limit') || '20', 10);

  try {
    // Get subscription tier for cost lookup
    const subscription = await getSubscriptionStatus(organization.id);
    const tier = subscription?.tier || 'free';

    // Get balance and costs in parallel
    const [balanceDetails, costs] = await Promise.all([
      getBalanceDetails(organization.id),
      getAllCosts(tier),
    ]);

    const response: CreditsResponse = {
      balance: balanceDetails.balance,
      lifetimePurchased: balanceDetails.lifetimePurchased,
      lifetimeUsed: balanceDetails.lifetimeUsed,
      tier: tier.toLowerCase(),
      costs,
    };

    // Optionally include transaction history
    if (includeHistory) {
      const transactions = await getTransactionHistory(organization.id, historyLimit);
      response.transactions = transactions.map((t) => ({
        id: t.id,
        type: t.type,
        amount: t.amount,
        balanceAfter: t.balanceAfter,
        description: t.description,
        createdAt: t.createdAt.toISOString(),
      }));
    }

    return NextResponse.json(response);
  } catch (error: any) {
    console.error('[CREDITS] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch credits' }, { status: 500 });
  }
}
