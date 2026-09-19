/**
 * Phase P2 — Stripe provider tests.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import crypto from 'node:crypto';

// Mock the Stripe SDK to avoid real API calls
// The mock implements real HMAC verification to test the webhook signature flow
vi.mock('stripe', () => {
  const realCrypto = require('node:crypto');

  return {
    default: vi.fn().mockImplementation(() => ({
      checkout: {
        sessions: {
          create: vi.fn().mockResolvedValue({
            id: 'cs_test_123',
            url: 'https://checkout.stripe.com/test-session',
            payment_intent: 'pi_live_test_123',
          }),
        },
      },
      webhooks: {
        constructEvent: vi.fn((body: string, sig: string, secret: string) => {
          // Parse the signature header
          const parts = sig.split(',').reduce((acc: Record<string, string>, part: string) => {
            const [key, value] = part.split('=');
            if (key && value) acc[key] = value;
            return acc;
          }, {});

          const timestamp = parts.t;
          const v1 = parts.v1;

          if (!timestamp || !v1) {
            throw new Error('Invalid signature format');
          }

          // Check timestamp is within 5 minutes
          const ts = parseInt(timestamp, 10);
          const now = Math.floor(Date.now() / 1000);
          if (Math.abs(now - ts) > 300) {
            throw new Error('Timestamp outside tolerance window');
          }

          // Verify HMAC signature
          const expected = realCrypto
            .createHmac('sha256', secret)
            .update(`${timestamp}.${body}`)
            .digest('hex');

          if (v1 !== expected) {
            throw new Error('Signature verification failed');
          }

          return JSON.parse(body);
        }),
      },
      refunds: {
        create: vi.fn().mockResolvedValue({
          id: 're_test_123',
          amount: 1000,
          status: 'succeeded',
        }),
      },
    })),
  };
});

// Mock logger to avoid side effects
vi.mock('@/app/api/utils/logger', () => ({
  logEvent: vi.fn(),
}));

import { MockStripeProvider, LiveStripeProvider, resetStripeProvider, getStripeProvider } from './stripeProvider';

const WEBHOOK_SECRET = 'whsec_test_secret_123';

function signStripeBody(body: string, timestampSeconds = Math.floor(Date.now() / 1000)): string {
  const signature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(`${timestampSeconds}.${body}`)
    .digest('hex');
  return `t=${timestampSeconds},v1=${signature}`;
}

describe('MockStripeProvider', () => {
  let provider: MockStripeProvider;

  beforeEach(() => {
    provider = new MockStripeProvider();
  });

  it('creates a payment link with mock PI ID', async () => {
    const result = await provider.createPaymentLink({
      contractId: 'contract-1',
      organizationId: 'org-1',
      amountCents: 1000000, // $10,000
    });

    expect(result.paymentLink).toContain('/api/payments/mock-checkout');
    expect(result.paymentLink).toContain('pi=pi_mock_');
    expect(result.paymentLink).toContain('contractId=contract-1');
    expect(result.paymentIntentId).toMatch(/^pi_mock_/);
    expect(result.status).toBe('created');
  });

  it('creates payment link with custom currency', async () => {
    const result = await provider.createPaymentLink({
      contractId: 'contract-2',
      organizationId: 'org-1',
      amountCents: 500000,
      currency: 'eur',
    });

    expect(result.paymentLink).toContain('amount=500000');
    expect(result.paymentIntentId).toMatch(/^pi_mock_/);
  });

  it('verifyWebhook always returns true for mock', () => {
    expect(provider.verifyWebhook({ body: '{}', signature: 'any' })).toBe(true);
    expect(provider.verifyWebhook({ body: '{}', signature: '' })).toBe(true);
  });

  it('parseWebhookEvent parses JSON body', () => {
    const event = provider.parseWebhookEvent(
      JSON.stringify({ type: 'payment_intent.succeeded', id: 'evt_1', data: { object: { id: 'pi_1', amount: 1000, currency: 'usd', status: 'succeeded' } } }),
      'any'
    );
    expect(event.type).toBe('payment_intent.succeeded');
    expect(event.data.object.amount).toBe(1000);
  });
});

describe('LiveStripeProvider', () => {
  let provider: LiveStripeProvider;
  let originalSecret: string | undefined;
  let originalSecretKey: string | undefined;

  beforeAll(() => {
    originalSecret = process.env.STRIPE_WEBHOOK_SECRET;
    originalSecretKey = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake_key_for_tests';
  });

  afterAll(() => {
    process.env.STRIPE_WEBHOOK_SECRET = originalSecret;
    if (originalSecretKey === undefined) {
      delete process.env.STRIPE_SECRET_KEY;
    } else {
      process.env.STRIPE_SECRET_KEY = originalSecretKey;
    }
  });

  beforeEach(() => {
    provider = new LiveStripeProvider();
  });

  it('creates a payment link with live PI ID', async () => {
    const result = await provider.createPaymentLink({
      contractId: 'contract-1',
      organizationId: 'org-1',
      amountCents: 1000000,
    });

    expect(result.paymentLink).toContain('checkout.stripe.com');
    expect(result.paymentIntentId).toMatch(/^pi_live_/);
    expect(result.status).toBe('created');
  });

  it('verifyWebhook accepts a real HMAC-signed payload', () => {
    const body = '{"type":"payment_intent.succeeded"}';
    expect(provider.verifyWebhook({ body, signature: signStripeBody(body) })).toBe(true);
  });

  it('verifyWebhook rejects a tampered body (signature no longer matches)', () => {
    const body = '{"type":"payment_intent.succeeded"}';
    const sig = signStripeBody(body);
    const tamperedBody = '{"type":"payment_intent.succeeded","amount":999999999}';
    expect(provider.verifyWebhook({ body: tamperedBody, signature: sig })).toBe(false);
  });

  it('verifyWebhook rejects a garbage/malformed signature header', () => {
    expect(provider.verifyWebhook({ body: '{}', signature: 'invalid' })).toBe(false);
    expect(provider.verifyWebhook({ body: '{}', signature: '' })).toBe(false);
  });

  it('verifyWebhook rejects a stale (replayed) timestamp outside tolerance', () => {
    const body = '{"type":"payment_intent.succeeded"}';
    const tenMinutesAgo = Math.floor(Date.now() / 1000) - 600;
    expect(provider.verifyWebhook({ body, signature: signStripeBody(body, tenMinutesAgo) })).toBe(false);
  });

  it('verifyWebhook rejects when STRIPE_WEBHOOK_SECRET is not configured', () => {
    const body = '{"type":"payment_intent.succeeded"}';
    const sig = signStripeBody(body);
    delete process.env.STRIPE_WEBHOOK_SECRET;
    try {
      expect(provider.verifyWebhook({ body, signature: sig })).toBe(false);
    } finally {
      process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    }
  });
});

describe('getStripeProvider', () => {
  let originalSecretKey: string | undefined;

  beforeAll(() => {
    originalSecretKey = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake_key_for_tests';
  });

  afterAll(() => {
    if (originalSecretKey === undefined) {
      delete process.env.STRIPE_SECRET_KEY;
    } else {
      process.env.STRIPE_SECRET_KEY = originalSecretKey;
    }
  });

  beforeEach(() => {
    resetStripeProvider();
  });

  it('returns MockStripeProvider by default', () => {
    const provider = getStripeProvider();
    expect(provider.type).toBe('mock');
    expect(provider).toBeInstanceOf(MockStripeProvider);
  });

  it('returns LiveStripeProvider when configured', () => {
    const provider = getStripeProvider({ type: 'live' });
    expect(provider.type).toBe('live');
    expect(provider).toBeInstanceOf(LiveStripeProvider);
  });

  it('caches the provider instance', () => {
    const p1 = getStripeProvider({ type: 'mock' });
    const p2 = getStripeProvider({ type: 'live' });
    expect(p1).toBe(p2);
    expect(p1.type).toBe('mock');
  });
});