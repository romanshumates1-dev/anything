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

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

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

// Fee floor validation
const FEE_FLOOR_CENTS = 500_000; // $5,000

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
    amount,
    propertyAddress,
    buyerName,
    buyerEmail,
  } = body;

  if (!dealId || !buyerId || !paymentType || !amount) {
    return Response.json(
      { error: 'dealId, buyerId, paymentType, and amount required' },
      { status: 400 }
    );
  }

  // Enforce fee floor
  if (amount < FEE_FLOOR_CENTS) {
    return Response.json(
      {
        success: false,
        error: `Assignment fee $${(amount / 100).toLocaleString()} is below minimum $5,000`,
        feeFloor: FEE_FLOOR_CENTS / 100,
      },
      { status: 400 }
    );
  }

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

    // Handle Stripe errors
    if (error.type === 'StripeCardError') {
      await alertPaymentFailed(
        dealId,
        buyerName || buyerId,
        amount / 100,
        error.message
      );

      return Response.json({
        success: false,
        amount,
        amountFormatted: `$${(amount / 100).toLocaleString()}`,
        paymentType,
        error: error.message,
        code: error.code,
      });
    }

    return Response.json(
      { success: false, error: 'Charge failed', details: error.message },
      { status: 500 }
    );
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
