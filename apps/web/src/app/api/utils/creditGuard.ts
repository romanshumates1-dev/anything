/**
 * Credit Guard - Middleware for credit checks
 *
 * Provides utilities for checking and deducting credits
 * before performing billable operations like SMS, email, and AI.
 */
import { NextResponse } from 'next/server';
import {
  canAffordAction,
  deductCreditsForAction,
  refundCredits,
  type CreditAction,
} from './credits';
import { getSubscriptionStatus } from './subscriptionGuard';

/**
 * Result of a credit guard check
 */
export interface CreditGuardResult {
  allowed: boolean;
  cost: number;
  balance: number;
  tier: string;
  error?: string;
}

/**
 * Check if an organization can perform a credit-consuming action.
 * Does NOT deduct credits - use deductCreditsForAction for that.
 */
export async function checkCredits(
  organizationId: string,
  action: CreditAction
): Promise<CreditGuardResult> {
  // Get subscription tier
  const subscription = await getSubscriptionStatus(organizationId);
  const tier = subscription?.tier || 'free';

  // Check if can afford
  const { canAfford, cost, balance } = await canAffordAction(organizationId, action, tier);

  if (!canAfford) {
    return {
      allowed: false,
      cost,
      balance,
      tier,
      error: `Insufficient credits. This action costs ${cost} credits but you only have ${balance}.`,
    };
  }

  return {
    allowed: true,
    cost,
    balance,
    tier,
  };
}

/**
 * Check credits and return 402 response if insufficient.
 * Use this in API routes to guard credit-consuming operations.
 */
export async function requireCredits(
  organizationId: string,
  action: CreditAction
): Promise<{ allowed: true; cost: number; tier: string } | NextResponse> {
  const result = await checkCredits(organizationId, action);

  if (!result.allowed) {
    return NextResponse.json(
      {
        error: 'Insufficient credits',
        message: result.error,
        code: 'INSUFFICIENT_CREDITS',
        details: {
          action,
          cost: result.cost,
          balance: result.balance,
          tier: result.tier,
        },
      },
      { status: 402 }
    );
  }

  return {
    allowed: true,
    cost: result.cost,
    tier: result.tier,
  };
}

/**
 * Perform a credit-consuming operation with automatic deduction and error handling.
 *
 * @param organizationId - The organization ID
 * @param action - The credit action type
 * @param operation - The async operation to perform
 * @param options - Additional options
 * @returns The operation result or error response
 */
export async function withCreditDeduction<T>(
  organizationId: string,
  action: CreditAction,
  operation: () => Promise<T>,
  options?: {
    description?: string;
    metadata?: Record<string, unknown>;
    /** If true, refund credits on operation failure */
    refundOnError?: boolean;
  }
): Promise<{ success: true; result: T; creditsDeducted: number } | { success: false; error: NextResponse }> {
  // Get tier and check credits
  const subscription = await getSubscriptionStatus(organizationId);
  const tier = subscription?.tier || 'free';

  // Deduct credits first
  const deduction = await deductCreditsForAction(
    organizationId,
    action,
    tier,
    options?.description,
    options?.metadata
  );

  if (!deduction.success) {
    return {
      success: false,
      error: NextResponse.json(
        {
          error: 'Insufficient credits',
          message: `This action costs credits but you don't have enough. Balance: ${deduction.remainingBalance}`,
          code: 'INSUFFICIENT_CREDITS',
          details: {
            action,
            balance: deduction.remainingBalance,
            tier,
          },
        },
        { status: 402 }
      ),
    };
  }

  try {
    // Perform the operation
    const result = await operation();
    return {
      success: true,
      result,
      creditsDeducted: deduction.deducted,
    };
  } catch (error) {
    // Optionally refund on error
    if (options?.refundOnError) {
      await refundCredits(
        organizationId,
        deduction.deducted,
        `Refund: ${action} operation failed`,
        {
          originalAction: action,
          error: error instanceof Error ? error.message : 'Unknown error',
          ...options?.metadata,
        }
      );
    }
    throw error;
  }
}

/**
 * Create a credit-aware wrapper for messaging functions.
 *
 * Usage:
 * ```ts
 * const sendWithCredits = createCreditAwareMessaging(orgId, tier);
 * await sendWithCredits.sms({ to, text });
 * await sendWithCredits.email({ to, subject, text });
 * ```
 */
export function createCreditAwareMessaging(organizationId: string, tier: string) {
  return {
    /**
     * Check if SMS can be sent (has enough credits)
     */
    canSendSms: async () => {
      const result = await checkCredits(organizationId, 'SMS_SEND');
      return result.allowed;
    },

    /**
     * Check if email can be sent (has enough credits)
     */
    canSendEmail: async () => {
      const result = await checkCredits(organizationId, 'EMAIL_SEND');
      return result.allowed;
    },

    /**
     * Deduct credits for SMS send
     */
    deductSms: async (metadata?: Record<string, unknown>) => {
      return deductCreditsForAction(
        organizationId,
        'SMS_SEND',
        tier,
        'SMS message sent',
        metadata
      );
    },

    /**
     * Deduct credits for email send
     */
    deductEmail: async (metadata?: Record<string, unknown>) => {
      return deductCreditsForAction(
        organizationId,
        'EMAIL_SEND',
        tier,
        'Email sent',
        metadata
      );
    },

    /**
     * Deduct credits for AI request
     */
    deductAi: async (metadata?: Record<string, unknown>) => {
      return deductCreditsForAction(
        organizationId,
        'AI_REQUEST',
        tier,
        'AI request',
        metadata
      );
    },
  };
}
