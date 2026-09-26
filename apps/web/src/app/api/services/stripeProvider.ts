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

// ─── Billing Checkout ────────────────────────────────────────────────────────

/**
 * Billing checkout — a one-time payment for a plan or a credit pack.
 *
 * Everything that decides WHAT is being bought and for WHICH organization is
 * decided by the route and passed in here; nothing is ever taken from the
 * client. It is mirrored into Stripe `metadata` so the webhook can resolve the
 * purchase from a signature-verified event alone.
 */
export interface BillingCheckoutParams {
  /** Authenticated user making the purchase. Recorded in metadata. */
  userId: string;
  /** Organization the purchase belongs to; omitted only on the signup flow. */
  organizationId?: string;
  /** Exactly one of planId / creditPackId is set. */
  planId?: string;
  creditPackId?: string;
  /** Authoritative charge amount in cents. Never taken from the client. */
  amountCents: number;
  currency?: string;
  productName: string;
  productDescription?: string;
  customerEmail?: string;
  /** Reuse this customer rather than creating a new one per checkout attempt. */
  stripeCustomerId?: string;
  successUrl: string;
  cancelUrl: string;
  /** Extra key/values stored on the session and its PaymentIntent. */
  metadata?: Record<string, string>;
  /** Session lifetime in seconds (Stripe allows 30 minutes–24 hours). */
  expiresInSeconds?: number;
}

export interface BillingCheckoutResult {
  checkoutUrl: string;
  sessionId: string;
  /** Customer the session was bound to, when Stripe created or returned one. */
  customerId?: string;
  status: string; // 'created'
}




// ─── Interface ───────────────────────────────────────────────────────────────

export interface StripeProvider {
  readonly type: StripeProviderType;
  createPaymentLink(params: CreatePaymentParams): Promise<PaymentResult>;
  createBillingCheckoutSession(params: BillingCheckoutParams): Promise<BillingCheckoutResult>;
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

  /**
   * Test double ONLY. The billing route will not route a real purchase through
   * the mock provider — `isPaymentLive()` in /api/billing/subscribe refuses and
   * returns a configuration error instead — so this exists purely so tests and
   * local tooling can exercise the redirect contract without a Stripe account.
   * It grants nothing and charges nothing.
   */
  async createBillingCheckoutSession(
    params: BillingCheckoutParams
  ): Promise<BillingCheckoutResult> {
    const sessionId = `cs_mock_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const baseUrl = process.env.PUBLIC_WEBHOOK_URL || 'http://localhost:4000';
    const query = new URLSearchParams({
      session: sessionId,
      amount: String(params.amountCents),
      ...(params.planId ? { planId: params.planId } : {}),
      ...(params.creditPackId ? { creditPackId: params.creditPackId } : {}),
    });

    await logEvent(
      'billing_checkout_created',
      'billing',
      params.organizationId ?? params.userId,
      {
        provider: 'mock',
        sessionId,
        amountCents: params.amountCents,
        planId: params.planId ?? null,
        creditPackId: params.creditPackId ?? null,
      },
      params.organizationId
    );

    return {
      checkoutUrl: `${baseUrl}/api/payments/mock-checkout?${query.toString()}`,
      sessionId,
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

  /**
   * Create a real Stripe Checkout Session (one-time payment).
   *
   * `metadata` is written to BOTH the session and its PaymentIntent so that
   * `checkout.session.completed` and `payment_intent.*` can each resolve the
   * organization on their own — the webhook never has to guess from an amount.
   */
  async createBillingCheckoutSession(
    params: BillingCheckoutParams
  ): Promise<BillingCheckoutResult> {
    const metadata: Record<string, string> = {
      ...(params.metadata ?? {}),
      userId: params.userId,
      ...(params.organizationId ? { organization_id: params.organizationId } : {}),
      ...(params.planId ? { plan_id: params.planId } : {}),
      ...(params.creditPackId ? { credit_pack_id: params.creditPackId } : {}),
    };

    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: params.currency || 'usd',
            product_data: {
              name: params.productName,
              ...(params.productDescription
                ? { description: params.productDescription }
                : {}),
            },
            unit_amount: params.amountCents,
          },
          quantity: 1,
        },
      ],
      // Reuse the organization's existing customer when we have one, so a retry
      // or a second purchase can never fork a duplicate Stripe customer.
      ...(params.stripeCustomerId
        ? { customer: params.stripeCustomerId }
        : params.customerEmail
          ? { customer_email: params.customerEmail }
          : {}),
      metadata,
      payment_intent_data: { metadata },
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      expires_at: Math.floor(Date.now() / 1000) + (params.expiresInSeconds ?? 3600),
    });

    if (!session.url) {
      throw new Error(
        `[stripeProvider] Stripe returned session ${session.id} without a checkout URL.`
      );
    }

    await logEvent(
      'billing_checkout_created',
      'billing',
      params.organizationId ?? params.userId,
      {
        provider: 'live',
        sessionId: session.id,
        amountCents: params.amountCents,
        planId: params.planId ?? null,
        creditPackId: params.creditPackId ?? null,
      },
      params.organizationId
    );

    const customerId =
      typeof session.customer === 'string' ? session.customer : session.customer?.id;

    return {
      checkoutUrl: session.url,
      sessionId: session.id,
      customerId,
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

// Cached PER TYPE, not globally. The previous single-slot cache returned the
// first provider it built and ignored `config.type` on every later call, so a
// process that touched the mock provider anywhere would hand the mock provider
// to the live webhook path too. That is exactly the kind of mistake that
// silently disables signature verification.
const _providers = new Map<StripeProviderType, StripeProvider>();

export function getStripeProvider(config?: { type?: StripeProviderType }): StripeProvider {
  const type: StripeProviderType = (config?.type ||
    process.env.STRIPE_PROVIDER ||
    'mock') as StripeProviderType;

  const cached = _providers.get(type);
  if (cached) return cached;

  const provider: StripeProvider =
    type === 'live' ? new LiveStripeProvider() : new MockStripeProvider();
  _providers.set(type, provider);
  return provider;
}

/** Reset the cached providers (for tests). */
export function resetStripeProvider(): void {
  _providers.clear();
}
