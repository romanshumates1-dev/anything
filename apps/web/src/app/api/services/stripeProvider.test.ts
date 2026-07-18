/**
 * Phase P2 — Stripe provider tests.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MockStripeProvider, LiveStripeProvider, resetStripeProvider, getStripeProvider } from './stripeProvider';

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
    expect(result.paymentLink).toContain('pi=mock_');
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

  it('verifyWebhook accepts valid signature', () => {
    expect(provider.verifyWebhook({ body: '{}', signature: 'stripe-valid' })).toBe(true);
  });

  it('verifyWebhook rejects invalid signature', () => {
    expect(provider.verifyWebhook({ body: '{}', signature: 'invalid' })).toBe(false);
    expect(provider.verifyWebhook({ body: '{}', signature: '' })).toBe(false);
  });
});

describe('getStripeProvider', () => {
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