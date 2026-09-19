/**
 * Subscription Refund API
 *
 * POST /api/billing/refund - Request a subscription refund
 * GET /api/billing/refund - Check refund eligibility
 *
 * 7-day refund policy:
 * - Refund available within 7 days of subscription purchase
 * - Credits USED during this period are non-refundable
 * - Reason: Credits represent third-party costs (Twilio, AWS, AI) that cannot be recovered
 */
import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { getOrganization } from '@/lib/organization-context';
import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';
import { calculateRefundAmount, formatCents } from '@/app/api/utils/refundCalculator';
import { getStripeProvider } from '@/app/api/services/stripeProvider';

/**
 * GET /api/billing/refund
 * Check refund eligibility for the current organization
 */
export async function GET(_req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const organization = await getOrganization();
  if (!organization) {
    return NextResponse.json({ error: 'No organization' }, { status: 403 });
  }

  try {
    const eligibility = await calculateRefundAmount(organization.id);

    return NextResponse.json({
      eligible: eligibility.eligible,
      reason: eligibility.reason,
      details: {
        subscriptionTier: eligibility.subscriptionTier,
        purchasedAt: eligibility.purchasedAt?.toISOString() || null,
        refundWindowEnds: eligibility.refundWindowEnds?.toISOString() || null,
        daysRemaining: eligibility.daysRemaining,
        subscriptionPrice: formatCents(eligibility.subscriptionPriceCents),
        subscriptionPriceCents: eligibility.subscriptionPriceCents,
        creditsUsed: eligibility.creditsUsedSincePurchase,
        creditsNonRefundable: formatCents(eligibility.creditsNonRefundableCents),
        creditsNonRefundableCents: eligibility.creditsNonRefundableCents,
        eligibleRefund: formatCents(eligibility.eligibleRefundCents),
        eligibleRefundCents: eligibility.eligibleRefundCents,
        alreadyRefunded: eligibility.alreadyRefunded,
      },
    });
  } catch (error: any) {
    console.error('[REFUND] GET error:', error);
    return NextResponse.json({ error: 'Failed to check refund eligibility' }, { status: 500 });
  }
}

/**
 * POST /api/billing/refund
 * Request a subscription refund
 */
export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const organization = await getOrganization();
  if (!organization) {
    return NextResponse.json({ error: 'No organization' }, { status: 403 });
  }

  let body: { reason?: string; confirmCreditsLoss?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // Empty body is OK
  }

  const { reason, confirmCreditsLoss } = body;

  try {
    // Calculate refund eligibility
    const eligibility = await calculateRefundAmount(organization.id);

    if (!eligibility.eligible) {
      return NextResponse.json(
        {
          error: 'Not eligible for refund',
          reason: eligibility.reason,
          details: {
            alreadyRefunded: eligibility.alreadyRefunded,
            daysRemaining: eligibility.daysRemaining,
          },
        },
        { status: 400 }
      );
    }

    // Require confirmation if credits were used
    if (eligibility.creditsUsedSincePurchase > 0 && !confirmCreditsLoss) {
      return NextResponse.json(
        {
          error: 'Confirmation required',
          message: `You have used ${eligibility.creditsUsedSincePurchase} credits (${formatCents(eligibility.creditsNonRefundableCents)}) which are non-refundable. Please confirm you understand this will be deducted from your refund.`,
          requiresConfirmation: true,
          creditsUsed: eligibility.creditsUsedSincePurchase,
          creditsNonRefundable: formatCents(eligibility.creditsNonRefundableCents),
          eligibleRefund: formatCents(eligibility.eligibleRefundCents),
        },
        { status: 400 }
      );
    }

    // Create refund request record
    const [refundRequest] = await sql`
      INSERT INTO subscription_refund_requests (
        organization_id,
        user_id,
        subscription_tier,
        subscription_price_cents,
        purchased_at,
        credits_used_since_purchase,
        credits_cost_cents,
        eligible_refund_cents,
        status
      ) VALUES (
        ${organization.id},
        ${session.user.id},
        ${eligibility.subscriptionTier},
        ${eligibility.subscriptionPriceCents},
        ${eligibility.purchasedAt?.toISOString()},
        ${eligibility.creditsUsedSincePurchase},
        ${eligibility.creditsNonRefundableCents},
        ${eligibility.eligibleRefundCents},
        'pending'
      )
      RETURNING id
    `;

    // Process refund through Stripe (if applicable)
    let stripeRefundId: string | null = null;
    let refundStatus = 'processed';

    try {
      // Get the payment intent ID from billing events or subscription
      const [billingEvent] = await sql`
        SELECT metadata->>'payment_intent_id' as payment_intent_id
        FROM billing_events
        WHERE organization_id = ${organization.id}
          AND event_type IN ('subscription_created', 'subscription_upgraded', 'payment_succeeded')
          AND metadata->>'payment_intent_id' IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 1
      `;

      if (billingEvent?.payment_intent_id) {
        const stripe = getStripeProvider();
        const refund = await stripe.refund({
          paymentIntentId: billingEvent.payment_intent_id,
          amountCents: eligibility.eligibleRefundCents,
          reason: reason || 'customer_requested',
        });
        stripeRefundId = refund.refundId;
        refundStatus = refund.status === 'succeeded' ? 'processed' : 'pending';
      } else {
        // No Stripe payment to refund (trial, manual, or mock mode)
        // Mark as processed anyway - admin may handle manually
        console.log('[REFUND] No Stripe payment found, marking as processed for manual handling');
      }
    } catch (stripeError: any) {
      console.error('[REFUND] Stripe refund failed:', stripeError);
      // Update request as failed but don't block the flow
      await sql`
        UPDATE subscription_refund_requests
        SET status = 'failed', rejection_reason = ${stripeError.message}
        WHERE id = ${refundRequest.id}
      `;

      return NextResponse.json(
        {
          error: 'Refund processing failed',
          message: 'Your refund request has been recorded but payment processing failed. Our team will review and process manually.',
          requestId: refundRequest.id,
        },
        { status: 500 }
      );
    }

    // Update refund request with Stripe details
    await sql`
      UPDATE subscription_refund_requests
      SET
        status = ${refundStatus},
        stripe_refund_id = ${stripeRefundId},
        processed_at = NOW()
      WHERE id = ${refundRequest.id}
    `;

    // Mark organization subscription as refunded
    await sql`
      UPDATE organizations
      SET
        subscription_refunded_at = NOW(),
        subscription_refund_amount_cents = ${eligibility.eligibleRefundCents},
        subscription_tier = 'free',
        subscription_price = 0,
        ai_credits = 0,
        updated_at = NOW()
      WHERE id = ${organization.id}
    `;

    // Record billing event
    await sql`
      INSERT INTO billing_events (
        id, organization_id, event_type, amount, metadata, created_at
      ) VALUES (
        ${crypto.randomUUID()},
        ${organization.id},
        'subscription_refunded',
        ${-eligibility.eligibleRefundCents / 100},
        ${JSON.stringify({
          refund_request_id: refundRequest.id,
          stripe_refund_id: stripeRefundId,
          original_tier: eligibility.subscriptionTier,
          original_price_cents: eligibility.subscriptionPriceCents,
          credits_used: eligibility.creditsUsedSincePurchase,
          credits_deducted_cents: eligibility.creditsNonRefundableCents,
          refund_amount_cents: eligibility.eligibleRefundCents,
          reason: reason || 'customer_requested',
        })},
        NOW()
      )
    `.catch(console.error);

    // Log the event
    await logEvent('subscription_refunded', 'billing', organization.id, {
      refundRequestId: refundRequest.id,
      stripeRefundId,
      originalTier: eligibility.subscriptionTier,
      originalPriceCents: eligibility.subscriptionPriceCents,
      creditsUsed: eligibility.creditsUsedSincePurchase,
      creditsDeductedCents: eligibility.creditsNonRefundableCents,
      refundAmountCents: eligibility.eligibleRefundCents,
      reason: reason || 'customer_requested',
    }, session.user.id);

    return NextResponse.json({
      success: true,
      message: 'Refund processed successfully',
      refund: {
        requestId: refundRequest.id,
        stripeRefundId,
        status: refundStatus,
        originalSubscription: eligibility.subscriptionTier,
        originalPrice: formatCents(eligibility.subscriptionPriceCents),
        creditsUsed: eligibility.creditsUsedSincePurchase,
        creditsDeducted: formatCents(eligibility.creditsNonRefundableCents),
        refundAmount: formatCents(eligibility.eligibleRefundCents),
        refundAmountCents: eligibility.eligibleRefundCents,
      },
    });
  } catch (error: any) {
    console.error('[REFUND] POST error:', error);
    return NextResponse.json({ error: 'Failed to process refund' }, { status: 500 });
  }
}
