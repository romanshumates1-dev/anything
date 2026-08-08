/**
 * Stripe Payment Integration API
 *
 * Handles:
 * - Payment intent creation
 * - Payment status checks
 * - Payment confirmation
 */
import { NextRequest } from 'next/server';
import Stripe from 'stripe';
import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  apiVersion: '2023-10-16',
});

interface CreatePaymentRequest {
  dealId: string;
  buyerId: string;
  amountCents: number;
  buyerEmail: string;
  description?: string;
}

async function logAudit(paymentId: string, eventType: string, eventData: any, actorId?: string) {
  await sql`
    INSERT INTO payment_audit_log (payment_id, event_type, event_data, actor_id)
    VALUES (${paymentId}, ${eventType}, ${JSON.stringify(eventData)}, ${actorId || null})
  `.catch(console.error);
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization' }, { status: 403 });
  }

  let body: CreatePaymentRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { dealId, buyerId, amountCents, buyerEmail, description } = body;

  if (!dealId || !buyerId || !amountCents) {
    return Response.json({ error: 'dealId, buyerId, and amountCents required' }, { status: 400 });
  }

  if (amountCents < 100) {
    return Response.json({ error: 'Minimum payment is $1.00' }, { status: 400 });
  }

  try {
    // Check if payment already exists for this deal
    const [existing] = await sql`
      SELECT id, status, stripe_payment_intent_id, stripe_client_secret
      FROM payments
      WHERE deal_id = ${dealId} AND buyer_id = ${buyerId} AND status != 'failed'
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (existing && existing.status === 'paid') {
      return Response.json({
        error: 'Payment already completed for this deal',
        paymentId: existing.id,
        status: 'paid'
      }, { status: 400 });
    }

    // If pending payment exists, return existing intent
    if (existing && existing.status === 'pending' && existing.stripe_payment_intent_id) {
      return Response.json({
        paymentId: existing.id,
        clientSecret: existing.stripe_client_secret,
        status: 'pending',
        message: 'Existing payment intent returned'
      });
    }

    // Create Stripe PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      receipt_email: buyerEmail,
      description: description || `Assignment fee for deal ${dealId}`,
      metadata: {
        dealId,
        buyerId,
        organizationId: organization.id,
      },
      automatic_payment_methods: {
        enabled: true,
      },
    });

    // Store payment record
    const [payment] = await sql`
      INSERT INTO payments (
        organization_id, deal_id, buyer_id, amount_cents, method, status,
        stripe_payment_intent_id, stripe_client_secret, metadata
      ) VALUES (
        ${organization.id}, ${dealId}, ${buyerId}, ${amountCents}, 'stripe', 'pending',
        ${paymentIntent.id}, ${paymentIntent.client_secret},
        ${JSON.stringify({ buyerEmail, description })}
      )
      RETURNING id
    `;

    await logAudit(payment.id, 'PAYMENT_INTENT_CREATED', {
      stripeIntentId: paymentIntent.id,
      amount: amountCents,
      buyerEmail,
    });

    console.log(`[STRIPE] PaymentIntent created: ${paymentIntent.id} for deal ${dealId}`);

    return Response.json({
      paymentId: payment.id,
      clientSecret: paymentIntent.client_secret,
      stripeIntentId: paymentIntent.id,
      amount: amountCents,
      status: 'pending',
    });
  } catch (error: any) {
    console.error('[STRIPE] Payment creation error:', error);

    if (error.type === 'StripeAuthenticationError') {
      return Response.json({
        error: 'Stripe API key not configured',
        code: 'STRIPE_AUTH_ERROR'
      }, { status: 500 });
    }

    return Response.json({
      error: error.message || 'Payment creation failed',
      code: error.code || 'UNKNOWN'
    }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const url = new URL(req.url);
  const paymentId = url.searchParams.get('paymentId');
  const dealId = url.searchParams.get('dealId');

  if (!paymentId && !dealId) {
    return Response.json({ error: 'paymentId or dealId required' }, { status: 400 });
  }

  try {
    let payment;
    if (paymentId) {
      [payment] = await sql`SELECT * FROM payments WHERE id = ${paymentId}`;
    } else {
      [payment] = await sql`
        SELECT * FROM payments WHERE deal_id = ${dealId}
        ORDER BY created_at DESC LIMIT 1
      `;
    }

    if (!payment) {
      return Response.json({ error: 'Payment not found' }, { status: 404 });
    }

    // If Stripe payment, fetch latest status from Stripe
    if (payment.stripe_payment_intent_id && payment.status === 'pending') {
      try {
        const intent = await stripe.paymentIntents.retrieve(payment.stripe_payment_intent_id);

        if (intent.status === 'succeeded' && payment.status !== 'paid') {
          // Update local status
          await sql`
            UPDATE payments
            SET status = 'paid', paid_at = NOW(), updated_at = NOW(),
                stripe_charge_id = ${intent.latest_charge}
            WHERE id = ${payment.id}
          `;
          payment.status = 'paid';
          payment.paid_at = new Date().toISOString();

          await logAudit(payment.id, 'PAYMENT_SUCCEEDED', { stripeStatus: intent.status });
        } else if (intent.status === 'canceled') {
          await sql`
            UPDATE payments SET status = 'failed', updated_at = NOW(),
            failure_reason = 'Payment canceled'
            WHERE id = ${payment.id}
          `;
          payment.status = 'failed';
        }
      } catch (stripeErr: any) {
        console.error('[STRIPE] Status check error:', stripeErr.message);
      }
    }

    return Response.json({
      payment: {
        id: payment.id,
        dealId: payment.deal_id,
        buyerId: payment.buyer_id,
        amountCents: payment.amount_cents,
        method: payment.method,
        status: payment.status,
        paidAt: payment.paid_at,
        createdAt: payment.created_at,
      }
    });
  } catch (error: any) {
    console.error('[STRIPE] Payment fetch error:', error);
    return Response.json({ error: 'Failed to fetch payment' }, { status: 500 });
  }
}
