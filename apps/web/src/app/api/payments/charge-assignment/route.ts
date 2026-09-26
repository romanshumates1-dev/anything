/**
 * Assignment Fee Charge API
 * POST /api/payments/charge-assignment
 * Charges the assignment fee AFTER buyer signs.
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import sql from '@/app/api/utils/sql';
import Stripe from 'stripe';
import {
  alertAssignmentFeePaid,
  alertPaymentFailed,
} from '@/app/api/alerts/notification-engine';
// [MEDIUM FIX] Import FEE_FLOOR_CENTS from single source of truth
import { FEE_FLOOR_CENTS } from '@/app/api/utils/negotiationEngine';
import { safeErrorResponse } from '@/app/api/utils/safeError';

if (!process.env.STRIPE_SECRET_KEY) {
  console.error('[STRIPE] STRIPE_SECRET_KEY not configured');
}

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

interface ChargeAssignmentBody {
  dealId: string;
  buyerId: string;
  paymentMethodId?: string; // For card/ACH
  paymentType: 'card' | 'ach' | 'wire';
  amount: number; // Assignment fee in cents
  propertyAddress?: string;
  buyerName?: string;
  buyerEmail?: string;
}

interface ChargeResult {
  success: boolean;
  chargeId?: string;
  amount: number;
  amountFormatted: string;
  paymentType: string;
  error?: string;
  receiptUrl?: string;
}

// [MEDIUM FIX] FEE_FLOOR_CENTS now imported from negotiationEngine.ts - no local redefinition
// SERVER-AUTHORITATIVE MONEY (2026-09-26): fee resolution shared with payments/stripe.
import { resolveAssignmentFeeCents } from '@/app/api/utils/assignmentFee';

// resolveAssignmentFeeCents is imported from '@/app/api/utils/assignmentFee' (see top of file).

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization' }, { status: 403 });
  }

  let body: ChargeAssignmentBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const {
    dealId,
    buyerId,
    paymentMethodId,
    paymentType,
    amount: requestedAmount,
    propertyAddress,
    buyerName,
    buyerEmail,
  } = body;

  if (!dealId || !buyerId || !paymentType || !requestedAmount) {
    return Response.json(
      { error: 'dealId, buyerId, paymentType, and amount required' },
      { status: 400 }
    );
  }

  // Enforce fee floor
  if (requestedAmount < FEE_FLOOR_CENTS) {
    return Response.json(
      {
        success: false,
        error: `Assignment fee $${(Number(requestedAmount) / 100).toLocaleString()} is below minimum $5,000`,
        feeFloor: FEE_FLOOR_CENTS / 100,
      },
      { status: 400 }
    );
  }

  // Server-resolved fee, hoisted so the error handler can report it even when
  // the failure happens inside the try block (scope fix 2026-09-26).
  let resolvedAmountCents = 0;

  try {
    // Verify buyer has signed (check contract status)
    const [contract] = await sql`
      SELECT c.*, l.metadata as deal_metadata
      FROM contracts c
      LEFT JOIN leads l ON l.id = c.seller_lead_id
      WHERE c.organization_id = ${organization.id}
      AND c.seller_lead_id = ${dealId}
      AND c.direction = 'BUYER'
      ORDER BY c.created_at DESC
      LIMIT 1
    `;

    if (!contract) {
      return Response.json(
        { success: false, error: 'No buyer contract found for this deal' },
        { status: 400 }
      );
    }

    if (contract.status !== 'SIGNED' && !contract.signed_at) {
      return Response.json(
        {
          success: false,
          error: 'Buyer must sign contract before payment can be charged',
          contractStatus: contract.status,
        },
        { status: 400 }
      );
    }

    // SERVER-AUTHORITATIVE MONEY: the figure charged to the buyer is derived
    // from the contract, never from the request. A mismatch is refused so the
    // UI can re-read the contract instead of silently charging a stale number.
    const amount = resolveAssignmentFeeCents(contract);
    resolvedAmountCents = amount;
    if (!amount) {
      return Response.json(
        {
          success: false,
          error:
            'Assignment fee could not be determined from the contract. Record the fee on the contract before charging.',
        },
        { status: 409 }
      );
    }
    if (Number(requestedAmount) !== amount) {
      return Response.json(
        {
          success: false,
          error: 'Assignment fee does not match the contract',
          expectedAmount: amount,
          requestedAmount: Number(requestedAmount) || requestedAmount,
        },
        { status: 409 }
      );
    }
    if (amount < FEE_FLOOR_CENTS) {
      return Response.json(
        {
          success: false,
          error: 'Assignment fee recorded on the contract is below the $5,000 minimum',
          feeFloor: FEE_FLOOR_CENTS / 100,
        },
        { status: 409 }
      );
    }

    let result: ChargeResult;

    if (paymentType === 'wire') {
      // Wire transfer - mark as pending, admin will confirm manually
      result = {
        success: true,
        chargeId: `wire_${Date.now()}`,
        amount,
        amountFormatted: `$${(amount / 100).toLocaleString()}`,
        paymentType: 'wire',
      };

      console.log(`[CHARGE-ASSIGNMENT] Deal ${dealId}: Wire transfer pending - $${(amount / 100).toLocaleString()}`);

      // Note: For wire, we don't trigger PAID alert until admin confirms receipt
    } else if (paymentType === 'card' || paymentType === 'ach') {
      if (!stripe) {
        return Response.json(
          { success: false, error: 'Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.', code: 'STRIPE_NOT_CONFIGURED' },
          { status: 503 }
        );
      }

      if (!paymentMethodId) {
        return Response.json(
          { success: false, error: 'paymentMethodId required for card/ACH' },
          { status: 400 }
        );
      }

      // Create and confirm payment intent
      const paymentIntent = await stripe.paymentIntents.create({
        amount,
        currency: 'usd',
        payment_method: paymentMethodId,
        confirm: true,
        metadata: {
          dealId,
          buyerId,
          organizationId: organization.id,
          type: 'assignment_fee',
          propertyAddress: propertyAddress || '',
          buyerName: buyerName || '',
        },
        description: `Assignment Fee - ${propertyAddress || dealId}`,
        receipt_email: buyerEmail,
      });

      if (paymentIntent.status === 'succeeded') {
        result = {
          success: true,
          chargeId: paymentIntent.id,
          amount,
          amountFormatted: `$${(amount / 100).toLocaleString()}`,
          paymentType,
          receiptUrl: (paymentIntent as any).charges?.data?.[0]?.receipt_url || undefined,
        };

        console.log(
          `[CHARGE-ASSIGNMENT] Deal ${dealId}: ${paymentType} charge SUCCESS - $${(amount / 100).toLocaleString()}`
        );

        // Send CRITICAL alert - Assignment Fee PAID!
        await alertAssignmentFeePaid(
          dealId,
          amount / 100,
          buyerName || buyerId,
          propertyAddress || dealId
        );
      } else {
        result = {
          success: false,
          amount,
          amountFormatted: `$${(amount / 100).toLocaleString()}`,
          paymentType,
          error: `Payment ${paymentIntent.status}: ${paymentIntent.last_payment_error?.message || 'Unknown error'}`,
        };

        console.log(
          `[CHARGE-ASSIGNMENT] Deal ${dealId}: ${paymentType} charge FAILED - ${result.error}`
        );

        // Alert admin of failed payment
        await alertPaymentFailed(
          dealId,
          buyerName || buyerId,
          amount / 100,
          result.error || 'Unknown error'
        );
      }
    } else {
      return Response.json(
        { success: false, error: 'Invalid paymentType' },
        { status: 400 }
      );
    }

    // Update contract with payment info if successful
    if (result.success && result.chargeId) {
      await sql`
        UPDATE contracts
        SET
          status = 'PAID',
          updated_at = NOW()
        WHERE id = ${contract.id}
        AND organization_id = ${organization.id}
      `;
    }

    return Response.json({
      dealId,
      buyerId,
      ...result,
      chargedAt: result.success ? new Date().toISOString() : undefined,
    });
  } catch (error: any) {
    console.error('[CHARGE-ASSIGNMENT] Error:', error);

    // Handle Stripe errors. A StripeCardError message is authored for the cardholder and
    // `code` is the machine-readable decline reason — both safe and needed to explain a
    // decline. (Line 251's use of error.message is an internal alert/log call, not a response.)
    if (error.type === 'StripeCardError') {
      await alertPaymentFailed(
        dealId,
        buyerName || buyerId,
        resolvedAmountCents / 100,
        error.message
      );

      return Response.json({
        success: false,
        amount: resolvedAmountCents,
        amountFormatted: `$${(resolvedAmountCents / 100).toLocaleString()}`,
        paymentType,
        error: error.message,
        code: error.code,
      });
    }

    // Anything else is an internal fault — do NOT echo it to the caller.
    return safeErrorResponse(error, {
      context: '[payments/charge-assignment]',
      message: 'Charge failed',
      code: 'CHARGE_FAILED',
      extra: { success: false },
    });
  }
}

/**
 * Confirm wire transfer received (admin action).
 * POST /api/payments/charge-assignment/confirm-wire
 */
export async function confirmWireReceived(
  dealId: string,
  organizationId: string,
  amount: number,
  buyerName: string,
  propertyAddress: string
): Promise<void> {
  // Send the CRITICAL alert
  await alertAssignmentFeePaid(dealId, amount, buyerName, propertyAddress);

  console.log(`[CHARGE-ASSIGNMENT] Deal ${dealId}: Wire transfer CONFIRMED - $${amount.toLocaleString()}`);
}
