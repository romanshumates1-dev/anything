/**
 * Refund Calculator Utility
 *
 * Calculates refund eligibility and amounts for subscription refunds.
 * Credits used are non-refundable since they represent third-party costs
 * (Twilio SMS, AWS SES, AI/Bedrock) that cannot be recovered.
 */
import sql from './sql';

/**
 * Average cost per credit in cents for refund calculations.
 * This represents the approximate third-party cost per credit used.
 * Conservative estimate to ensure we don't lose money on refunds.
 */
const CREDIT_COST_CENTS = 3.5; // $0.035 per credit average

/**
 * Refund eligibility window in days
 */
const REFUND_WINDOW_DAYS = 7;

export interface RefundEligibility {
  eligible: boolean;
  reason?: string;
  purchasedAt: Date | null;
  refundWindowEnds: Date | null;
  daysRemaining: number;
  subscriptionPriceCents: number;
  creditsUsedSincePurchase: number;
  creditsNonRefundableCents: number;
  eligibleRefundCents: number;
  subscriptionTier: string | null;
  alreadyRefunded: boolean;
}

export interface CreditUsageSummary {
  totalCreditsUsed: number;
  transactions: Array<{
    id: string;
    type: string;
    amount: number;
    description: string;
    createdAt: Date;
  }>;
}

/**
 * Get credits used by an organization since a specific date.
 * Only counts DEDUCT transactions (actual usage, not refunds/adjustments).
 */
export async function getCreditsUsedSince(
  organizationId: string,
  since: Date
): Promise<CreditUsageSummary> {
  try {
    // Get all deduction transactions since the purchase date
    const transactions = await sql`
      SELECT id, type, amount, description, created_at
      FROM credit_transactions
      WHERE organization_id = ${organizationId}
        AND type = 'DEDUCT'
        AND created_at >= ${since.toISOString()}
      ORDER BY created_at DESC
    `;

    // Sum up credits used (amount is negative for deductions)
    const totalCreditsUsed = transactions.reduce((sum: number, tx: any) => {
      // Deductions are stored as negative amounts
      return sum + Math.abs(tx.amount);
    }, 0);

    return {
      totalCreditsUsed,
      transactions: transactions.map((tx: any) => ({
        id: tx.id,
        type: tx.type,
        amount: Math.abs(tx.amount),
        description: tx.description || 'Credit usage',
        createdAt: new Date(tx.created_at),
      })),
    };
  } catch (error) {
    console.error('[REFUND] Failed to get credits used:', error);
    return { totalCreditsUsed: 0, transactions: [] };
  }
}

/**
 * Calculate the refund amount for an organization's subscription.
 *
 * Formula: Refund = Subscription Price - (Credits Used * Credit Cost)
 *
 * @param organizationId - The organization requesting the refund
 * @returns RefundEligibility object with all calculation details
 */
export async function calculateRefundAmount(
  organizationId: string
): Promise<RefundEligibility> {
  try {
    // Get organization subscription details
    const [org] = await sql`
      SELECT
        id,
        subscription_tier,
        subscription_price,
        subscription_purchased_at,
        subscription_refund_eligible_until,
        subscription_refunded_at,
        created_at
      FROM organizations
      WHERE id = ${organizationId}
    `;

    if (!org) {
      return {
        eligible: false,
        reason: 'Organization not found',
        purchasedAt: null,
        refundWindowEnds: null,
        daysRemaining: 0,
        subscriptionPriceCents: 0,
        creditsUsedSincePurchase: 0,
        creditsNonRefundableCents: 0,
        eligibleRefundCents: 0,
        subscriptionTier: null,
        alreadyRefunded: false,
      };
    }

    // Check if already refunded
    if (org.subscription_refunded_at) {
      return {
        eligible: false,
        reason: 'Subscription has already been refunded',
        purchasedAt: org.subscription_purchased_at ? new Date(org.subscription_purchased_at) : null,
        refundWindowEnds: org.subscription_refund_eligible_until ? new Date(org.subscription_refund_eligible_until) : null,
        daysRemaining: 0,
        subscriptionPriceCents: (org.subscription_price || 0) * 100,
        creditsUsedSincePurchase: 0,
        creditsNonRefundableCents: 0,
        eligibleRefundCents: 0,
        subscriptionTier: org.subscription_tier,
        alreadyRefunded: true,
      };
    }

    // Check if there's a subscription to refund
    if (!org.subscription_tier || org.subscription_tier === 'free') {
      return {
        eligible: false,
        reason: 'No paid subscription to refund',
        purchasedAt: null,
        refundWindowEnds: null,
        daysRemaining: 0,
        subscriptionPriceCents: 0,
        creditsUsedSincePurchase: 0,
        creditsNonRefundableCents: 0,
        eligibleRefundCents: 0,
        subscriptionTier: org.subscription_tier,
        alreadyRefunded: false,
      };
    }

    // Determine purchase date (use subscription_purchased_at or created_at as fallback)
    const purchasedAt = org.subscription_purchased_at
      ? new Date(org.subscription_purchased_at)
      : new Date(org.created_at);

    // Calculate refund window end
    const refundWindowEnds = org.subscription_refund_eligible_until
      ? new Date(org.subscription_refund_eligible_until)
      : new Date(purchasedAt.getTime() + REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const now = new Date();
    const daysRemaining = Math.max(
      0,
      Math.ceil((refundWindowEnds.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
    );

    // Check if within refund window
    if (now > refundWindowEnds) {
      return {
        eligible: false,
        reason: `Refund window expired on ${refundWindowEnds.toLocaleDateString()}`,
        purchasedAt,
        refundWindowEnds,
        daysRemaining: 0,
        subscriptionPriceCents: (org.subscription_price || 0) * 100,
        creditsUsedSincePurchase: 0,
        creditsNonRefundableCents: 0,
        eligibleRefundCents: 0,
        subscriptionTier: org.subscription_tier,
        alreadyRefunded: false,
      };
    }

    // Get credits used since purchase
    const creditUsage = await getCreditsUsedSince(organizationId, purchasedAt);

    // Calculate amounts
    const subscriptionPriceCents = (org.subscription_price || 0) * 100; // stored in dollars, convert to cents
    const creditsNonRefundableCents = Math.round(creditUsage.totalCreditsUsed * CREDIT_COST_CENTS);
    const eligibleRefundCents = Math.max(0, subscriptionPriceCents - creditsNonRefundableCents);

    // Check if there's anything left to refund
    if (eligibleRefundCents <= 0) {
      return {
        eligible: false,
        reason: 'Credit usage exceeds subscription price - no refund available',
        purchasedAt,
        refundWindowEnds,
        daysRemaining,
        subscriptionPriceCents,
        creditsUsedSincePurchase: creditUsage.totalCreditsUsed,
        creditsNonRefundableCents,
        eligibleRefundCents: 0,
        subscriptionTier: org.subscription_tier,
        alreadyRefunded: false,
      };
    }

    return {
      eligible: true,
      purchasedAt,
      refundWindowEnds,
      daysRemaining,
      subscriptionPriceCents,
      creditsUsedSincePurchase: creditUsage.totalCreditsUsed,
      creditsNonRefundableCents,
      eligibleRefundCents,
      subscriptionTier: org.subscription_tier,
      alreadyRefunded: false,
    };
  } catch (error) {
    console.error('[REFUND] Failed to calculate refund amount:', error);
    return {
      eligible: false,
      reason: 'Failed to calculate refund eligibility',
      purchasedAt: null,
      refundWindowEnds: null,
      daysRemaining: 0,
      subscriptionPriceCents: 0,
      creditsUsedSincePurchase: 0,
      creditsNonRefundableCents: 0,
      eligibleRefundCents: 0,
      subscriptionTier: null,
      alreadyRefunded: false,
    };
  }
}

/**
 * Format cents as a dollar string (e.g., 1999 -> "$19.99")
 */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Get a human-readable refund summary for display
 */
export function getRefundSummary(eligibility: RefundEligibility): string {
  if (!eligibility.eligible) {
    return eligibility.reason || 'Not eligible for refund';
  }

  const parts = [
    `Subscription: ${formatCents(eligibility.subscriptionPriceCents)}`,
    `Credits used: ${eligibility.creditsUsedSincePurchase} (${formatCents(eligibility.creditsNonRefundableCents)} non-refundable)`,
    `Eligible refund: ${formatCents(eligibility.eligibleRefundCents)}`,
  ];

  if (eligibility.daysRemaining > 0) {
    parts.push(`${eligibility.daysRemaining} day${eligibility.daysRemaining === 1 ? '' : 's'} remaining to request refund`);
  }

  return parts.join('\n');
}
