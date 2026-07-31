/**
 * Phase P2 — Stripe payment provider driver interface.
 *
 * Same pattern as esignProvider.ts / smsMode.ts:
 *   mock        — generates a mock PaymentIntent/PaymentLink, simulates webhook
 *   live        — real Stripe API (stub with `// LIVE:` markers)
 *
 * The mock driver is the default and passes all gates without live keys.
 * Live Stripe keys are OWNER-GATED.
 */
import { logEvent } from '@/app/api/utils/logger';
import Stripe from 'stripe';

// ─── Types ───────────────────────────────────────────────────────────────────

export type StripeProviderType = 'mock' | 'live';

export interface CreatePaymentParams {
  contractId: string;
  organizationId: string;
  amountCents: number;
  currency?: string;
  buyerEmail?: string;
  description?: string;
}

export interface PaymentResult {
  paymentLink: string;
  paymentIntentId: string;
  clientSecret?: string;
  status: string;
}

export interface VerifyWebhookParams {
  body: string;
  signature: string;
}

export interface RefundParams {
  paymentIntentId: string;
  amountCents?: number; // omit for full refund
  reason?: string;
}

export interface RefundResult {
  refundId: string;
  status: string; // 'succeeded' | 'pending' | ...
}



// ─── Interface ───────────────────────────────────────────────────────────────

export interface StripeProvider {
  readonly type: StripeProviderType;
  createPaymentLink(params: CreatePaymentParams): Promise<PaymentResult>;
  parseWebhookEvent(body: string, signature: string): Stripe.Event;
  verifyWebhook(params: VerifyWebhookParams): boolean;
  refund(params: RefundParams): Promise<RefundResult>;
}

// ─── Mock Provider ───────────────────────────────────────────────────────────

export class MockStripeProvider implements StripeProvider {
  readonly type: StripeProviderType = 'mock';

  async createPaymentLink(params: CreatePaymentParams): Promise<PaymentResult> {
    const paymentIntentId = `pi_mock_${crypto.randomUUID()}`;
    const amount = params.amountCents;

    // Generate a mock payment link. In dev, this simulates a Stripe hosted checkout.
    const baseUrl = process.env.PUBLIC_WEBHOOK_URL || `http://localhost:4000`;
    const paymentLink = `${baseUrl}/api/payments/mock-checkout?pi=${paymentIntentId}&contractId=${params.contractId}&amount=${amount}`;

    await logEvent('payment_link_created', 'contract', params.contractId, {
      provider: 'mock',
      paymentIntentId,
      amountCents: amount,
      currency: params.currency || 'usd',
    }, params.organizationId);

    return {
      paymentLink,
      paymentIntentId,
      status: 'created',
    };
  }

  parseWebhookEvent(body: string, _signature: string): Stripe.Event {
    return JSON.parse(body) as Stripe.Event;
  }

  verifyWebhook(_params: VerifyWebhookParams): boolean {
    // Mock provider accepts any signature in dev
    return true;
  }

  async refund(params: RefundParams): Promise<RefundResult> {
    // No money moves — returns a realistic mock refund id so the full
    // admin-refund path (ledger mirror + entitlement + audit) can be exercised
    // and tested end-to-end without Stripe. Live refunds require test/live keys.
    const refundId = `re_mock_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
    await logEvent('payment_refunded', 'payment', params.paymentIntentId, {
      provider: 'mock',
      refundId,
      amountCents: params.amountCents ?? null,
      reason: params.reason ?? null,
    });
    return { refundId, status: 'succeeded' };
  }
}

// ─── Live Stripe Provider (stub) ─────────────────────────────────────────────

export class LiveStripeProvider implements StripeProvider {
  readonly type: StripeProviderType = 'live';

  async createPaymentLink(params: CreatePaymentParams): Promise<PaymentResult> {
    // LIVE: Replace with real Stripe API call
    // const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    // const session = await stripe.checkout.sessions.create({
    //   mode: 'payment',
    //   line_items: [{ price_data: { currency: 'usd', product_data: { name: `Assignment Fee - Contract ${params.contractId}` }, unit_amount: params.amountCents }, quantity: 1 }],
    //   metadata: { contractId: params.contractId, organizationId: params.organizationId },
    //   success_url: `${baseUrl}/contracts/${params.contractId}?payment=success`,
    //   cancel_url: `${baseUrl}/contracts/${params.contractId}?payment=cancelled`,
    // });
    // return { paymentLink: session.url!, paymentIntentId: session.payment_intent as string, status: 'created' };

    const paymentIntentId = `pi_live_${crypto.randomUUID()}`;

    await logEvent('payment_link_created', 'contract', params.contractId, {
      provider: 'live',
      paymentIntentId,
      amountCents: params.amountCents,
      note: 'LIVE: Replace with real Stripe Checkout Session creation',
    }, params.organizationId);

    return {
      paymentLink: `https://checkout.stripe.com/pay/${paymentIntentId}`,
      paymentIntentId,
      status: 'created',
    };
  }

  parseWebhookEvent(body: string, signature: string): Stripe.Event {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      throw new Error('[stripeProvider] STRIPE_WEBHOOK_SECRET not configured.');
    }
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_dummy');
    return stripe.webhooks.constructEvent(body, signature, secret);
  }

  verifyWebhook(params: VerifyWebhookParams): boolean {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) return false;
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_dummy');
      stripe.webhooks.constructEvent(params.body, params.signature, secret);
      return true;
    } catch {
      return false;
    }
  }

  async refund(params: RefundParams): Promise<RefundResult> {
    // LIVE: Replace with a real Stripe refund (OWNER-GATED on live/test keys):
    // const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    // const r = await stripe.refunds.create({
    //   payment_intent: params.paymentIntentId,
    //   amount: params.amountCents, // omit for full
    //   reason: 'requested_by_customer',
    // });
    // return { refundId: r.id, status: r.status ?? 'pending' };
    const refundId = `re_live_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
    await logEvent('payment_refunded', 'payment', params.paymentIntentId, {
      provider: 'live',
      refundId,
      note: 'LIVE: Replace with real Stripe refunds.create',
    });
    return { refundId, status: 'pending' };
  }
}

// ─── Provider Resolution ─────────────────────────────────────────────────────

let _provider: StripeProvider | null = null;

export function getStripeProvider(config?: { type?: StripeProviderType }): StripeProvider {
  if (_provider) return _provider;

  const type: StripeProviderType = (config?.type || process.env.STRIPE_PROVIDER || 'mock') as StripeProviderType;

  switch (type) {
    case 'live':
      _provider = new LiveStripeProvider();
      break;
    case 'mock':
    default:
      _provider = new MockStripeProvider();
      break;
  }

  return _provider;
}

/** Reset the cached provider (for tests). */
export function resetStripeProvider(): void {
  _provider = null;
}