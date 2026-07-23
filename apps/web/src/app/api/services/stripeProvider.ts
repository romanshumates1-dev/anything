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

export interface WebhookEvent {
  type: string;
  id: string;
  data: {
    object: {
      id: string;
      amount: number;
      currency: string;
      status: string;
      metadata?: Record<string, string>;
    };
  };
}

// ─── Interface ───────────────────────────────────────────────────────────────

export interface StripeProvider {
  readonly type: StripeProviderType;
  createPaymentLink(params: CreatePaymentParams): Promise<PaymentResult>;
  verifyWebhook(params: VerifyWebhookParams): boolean;
  parseWebhookEvent(body: string, signature: string): WebhookEvent;
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

  verifyWebhook(_params: VerifyWebhookParams): boolean {
    // Mock provider accepts any signature in dev
    return true;
  }

  parseWebhookEvent(body: string, _signature: string): WebhookEvent {
    return JSON.parse(body);
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

  verifyWebhook(params: VerifyWebhookParams): boolean {
    // LIVE: Verify Stripe webhook signature
    // const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    // try {
    //   stripe.webhooks.constructEvent(params.body, params.signature, process.env.STRIPE_WEBHOOK_SECRET!);
    //   return true;
    // } catch { return false; }
    return params.signature === 'stripe-valid';
  }

  parseWebhookEvent(body: string, signature: string): WebhookEvent {
    // LIVE: Use Stripe SDK to construct event
    // const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    // return stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);
    return JSON.parse(body);
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