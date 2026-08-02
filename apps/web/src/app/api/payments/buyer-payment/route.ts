/**
 * Buyer Payment Validation API
 * POST /api/payments/buyer-payment
 * Validates payment method BEFORE buyer signs (does NOT charge).
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

interface PaymentValidationBody {
  dealId: string;
  buyerId: string;
  paymentMethodType: 'card' | 'ach' | 'wire';
  paymentMethodId?: string; // For card/ACH via Stripe
  amount: number; // Assignment fee in cents
}

interface PaymentValidationResult {
  valid: boolean;
  paymentMethodId?: string;
  type: 'card' | 'ach' | 'wire';
  last4?: string;
  brand?: string;
  authId?: string; // $1 auth ID for later capture/void
  error?: string;
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization' }, { status: 403 });
  }

  let body: PaymentValidationBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { dealId, buyerId, paymentMethodType, paymentMethodId, amount } = body;

  if (!dealId || !buyerId || !paymentMethodType) {
    return Response.json(
      { error: 'dealId, buyerId, and paymentMethodType required' },
      { status: 400 }
    );
  }

  if (amount < 500000) {
    // Minimum $5,000 fee floor
    return Response.json(
      { error: 'Assignment fee must be at least $5,000', feeFloor: 5000 },
      { status: 400 }
    );
  }

  try {
    let result: PaymentValidationResult;

    if (paymentMethodType === 'wire') {
      // Wire transfer - no validation needed, just record intent
      result = {
        valid: true,
        type: 'wire',
      };

      console.log(`[PAYMENT-VALIDATE] Deal ${dealId}: Wire transfer selected`);
    } else if (paymentMethodType === 'card' || paymentMethodType === 'ach') {
      // Card or ACH via Stripe
      if (!paymentMethodId) {
        return Response.json(
          { error: 'paymentMethodId required for card/ACH' },
          { status: 400 }
        );
      }

      // Retrieve payment method details
      const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);

      // Perform $1 authorization hold to validate the payment method
      const authIntent = await stripe.paymentIntents.create({
        amount: 100, // $1.00 in cents
        currency: 'usd',
        payment_method: paymentMethodId,
        confirm: true,
        capture_method: 'manual', // Hold, don't capture
        metadata: {
          dealId,
          buyerId,
          organizationId: organization.id,
          validationType: 'payment_method_verification',
          actualAmount: amount,
        },
        description: 'Payment method verification (will be voided)',
      });

      if (authIntent.status !== 'requires_capture') {
        // Auth failed
        result = {
          valid: false,
          type: paymentMethodType,
          error: `Authorization failed: ${authIntent.status}`,
        };
      } else {
        // Auth succeeded - void it immediately (we just wanted to verify)
        await stripe.paymentIntents.cancel(authIntent.id);

        result = {
          valid: true,
          paymentMethodId,
          type: paymentMethodType,
          authId: authIntent.id,
        };

        if (paymentMethod.type === 'card' && paymentMethod.card) {
          result.last4 = paymentMethod.card.last4 ?? undefined;
          result.brand = paymentMethod.card.brand ?? undefined;
        } else if (paymentMethod.type === 'us_bank_account' && paymentMethod.us_bank_account) {
          result.last4 = paymentMethod.us_bank_account.last4 ?? undefined;
          result.brand = paymentMethod.us_bank_account.bank_name ?? undefined;
        }
      }

      console.log(
        `[PAYMENT-VALIDATE] Deal ${dealId}: ${paymentMethodType} validation ${result.valid ? 'SUCCESS' : 'FAILED'}` +
        (result.last4 ? ` (**** ${result.last4})` : '')
      );
    } else {
      return Response.json(
        { error: 'Invalid paymentMethodType. Must be card, ach, or wire' },
        { status: 400 }
      );
    }

    return Response.json({
      dealId,
      buyerId,
      ...result,
      amount,
      amountFormatted: `$${(amount / 100).toLocaleString()}`,
      validatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[PAYMENT-VALIDATE] Error:', error);

    // Handle Stripe-specific errors
    if (error.type === 'StripeCardError') {
      return Response.json({
        valid: false,
        type: paymentMethodType,
        error: error.message,
        code: error.code,
      });
    }

    return Response.json(
      { error: 'Payment validation failed', details: error.message },
      { status: 500 }
    );
  }
}
