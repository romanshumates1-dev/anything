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

// ─── Live Stripe Provider ────────────────────────────────────────────────────

export class LiveStripeProvider implements StripeProvider {
  readonly type: StripeProviderType = 'live';
  private stripe: Stripe;

  constructor() {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error('[stripeProvider] STRIPE_SECRET_KEY not configured for live mode.');
    }
    this.stripe = new Stripe(secretKey);
  }

  async createPaymentLink(params: CreatePaymentParams): Promise<PaymentResult> {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.PUBLIC_WEBHOOK_URL || 'http://localhost:3000';

    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: params.currency || 'usd',
            product_data: {
              name: params.description || `Assignment Fee - Contract ${params.contractId}`,
            },
            unit_amount: params.amountCents,
          },
          quantity: 1,
        },
      ],
      customer_email: params.buyerEmail,
      metadata: {
        contractId: params.contractId,
        organizationId: params.organizationId,
      },
      success_url: `${baseUrl}/contracts/${params.contractId}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/contracts/${params.contractId}?payment=cancelled`,
      payment_intent_data: {
        metadata: {
          contractId: params.contractId,
          organizationId: params.organizationId,
        },
      },
    });

    const paymentIntentId = typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id ?? `cs_${session.id}`;

    await logEvent('payment_link_created', 'contract', params.contractId, {
      provider: 'live',
      sessionId: session.id,
      paymentIntentId,
      amountCents: params.amountCents,
      currency: params.currency || 'usd',
      url: session.url,
    }, params.organizationId);

    return {
      paymentLink: session.url!,
      paymentIntentId,
      status: 'created',
    };
  }

  parseWebhookEvent(body: string, signature: string): Stripe.Event {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      throw new Error('[stripeProvider] STRIPE_WEBHOOK_SECRET not configured.');
    }
    return this.stripe.webhooks.constructEvent(body, signature, secret);
  }

  verifyWebhook(params: VerifyWebhookParams): boolean {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) return false;
    try {
      this.stripe.webhooks.constructEvent(params.body, params.signature, secret);
      return true;
    } catch {
      return false;
    }
  }

  async refund(params: RefundParams): Promise<RefundResult> {
    const refundParams: Stripe.RefundCreateParams = {
      payment_intent: params.paymentIntentId,
      reason: 'requested_by_customer',
    };

    if (params.amountCents !== undefined) {
      refundParams.amount = params.amountCents;
    }

    const refund = await this.stripe.refunds.create(refundParams);

    await logEvent('payment_refunded', 'payment', params.paymentIntentId, {
      provider: 'live',
      refundId: refund.id,
      amountCents: refund.amount,
      status: refund.status,
      reason: params.reason ?? 'requested_by_customer',
    });

    return {
      refundId: refund.id,
      status: refund.status ?? 'pending',
    };
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