/**
 * Phase P2 — Stripe webhook tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/app/api/utils/sql', () => ({
  default: vi.fn(),
}));

vi.mock('@/app/api/utils/logger', () => ({
  logEvent: vi.fn(),
}));

vi.mock('@/app/api/utils/jobs', () => ({
  enqueueJob: vi.fn(),
}));

// Mock stripeProvider to control signature verification behavior
const mockVerifyWebhook = vi.fn(() => true);
const mockParseWebhookEvent = vi.fn((body: string) => JSON.parse(body));

vi.mock('@/app/api/services/stripeProvider', () => ({
  getStripeProvider: vi.fn(() => ({
    type: 'mock',
    verifyWebhook: mockVerifyWebhook,
    parseWebhookEvent: mockParseWebhookEvent,
  })),
  resetStripeProvider: vi.fn(),
}));

import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';
import { POST } from './route';

function createMockRequest(body: any, signature = 'any'): Request {
  return new Request('http://localhost:4000/api/payments/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': signature,
    },
    body: JSON.stringify(body),
  });
}

describe('Payments Webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock behavior to defaults
    mockVerifyWebhook.mockReturnValue(true);
    mockParseWebhookEvent.mockImplementation((body: string) => JSON.parse(body));
  });

  it('processes payment_intent.succeeded and marks ledger paid', async () => {
    (sql as any).mockImplementation(async (strings: any, ...values: any[]) => {
      const query = strings.join('?').toLowerCase();
      if (query.includes('select 1 from payments_ledger')) return [];
      if (query.includes('pl.id') && query.includes('payments_ledger') && query.includes('stripe_payment_intent_id')) {
        return [{ id: 'pay-1', contract_id: 'c-1', amount_cents: 100000, status: 'sent' }];
      }
      if (query.includes('update payments_ledger')) return [];
      return [];
    });

    const response = await POST(createMockRequest({
      type: 'payment_intent.succeeded',
      id: 'evt_1',
      data: { object: { id: 'pi_1', amount: 100000, currency: 'usd', status: 'succeeded' } },
    }));

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(logEvent).toHaveBeenCalledWith('payment_paid', 'contract', 'c-1', expect.any(Object));
  });

  it('rejects tampered signature for live provider', async () => {
    // Configure mock to reject the signature
    mockVerifyWebhook.mockReturnValue(false);

    const response = await POST(createMockRequest(
      { type: 'payment_intent.succeeded', id: 'evt_1', data: { object: { id: 'pi_1', amount: 1000, currency: 'usd', status: 'succeeded' } } },
      'invalid'
    ));

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe('Invalid signature');
  });

  it('returns 200 idempotent for duplicate events', async () => {
    (sql as any).mockImplementation(async (strings: any, ...values: any[]) => {
      const query = strings.join('?').toLowerCase();
      if (query.includes('select 1 from payments_ledger')) {
        return [{ exists: true }];
      }
      return [];
    });

    const response = await POST(createMockRequest({
      type: 'payment_intent.succeeded',
      id: 'evt_1',
      data: { object: { id: 'pi_1', amount: 1000, currency: 'usd', status: 'succeeded' } },
    }));

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.idempotent).toBe(true);
  });

  it('holds payment on amount mismatch', async () => {
    (sql as any).mockImplementation(async (strings: any, ...values: any[]) => {
      const query = strings.join('?').toLowerCase();
      if (query.includes('select 1 from payments_ledger')) return [];
      if (query.includes('pl.id') && query.includes('payments_ledger') && query.includes('stripe_payment_intent_id')) {
        return [{ id: 'pay-1', contract_id: 'c-1', amount_cents: 50000, status: 'sent' }];
      }
      return [];
    });

    const response = await POST(createMockRequest({
      type: 'payment_intent.succeeded',
      id: 'evt_2',
      data: { object: { id: 'pi_2', amount: 100000, currency: 'usd', status: 'succeeded' } },
    }));

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.held).toBe(true);
    expect(data.reason).toBe('amount_mismatch');
    expect(logEvent).toHaveBeenCalledWith('payment_amount_mismatch', expect.any(String), expect.any(String), expect.any(Object));
  });

  it('returns 404 for unknown payment intent', async () => {
    (sql as any).mockImplementation(async (strings: any, ...values: any[]) => {
      const query = strings.join('?').toLowerCase();
      if (query.includes('select 1 from payments_ledger')) return [];
      if (query.includes('pl.id') && query.includes('payments_ledger')) return [];
      return [];
    });

    const response = await POST(createMockRequest({
      type: 'payment_intent.succeeded',
      id: 'evt_3',
      data: { object: { id: 'pi_unknown', amount: 1000, currency: 'usd', status: 'succeeded' } },
    }));

    expect(response.status).toBe(404);
  });

  it('processes payment_intent.payment_failed', async () => {
    (sql as any).mockImplementation(async (strings: any, ...values: any[]) => {
      const query = strings.join('?').toLowerCase();
      if (query.includes('select 1 from payments_ledger')) return [];
      if (query.includes('pl.id') && query.includes('payments_ledger') && query.includes('stripe_payment_intent_id')) {
        return [{ id: 'pay-1', contract_id: 'c-1', amount_cents: 100000, status: 'sent' }];
      }
      if (query.includes('update payments_ledger')) return [];
      return [];
    });

    const response = await POST(createMockRequest({
      type: 'payment_intent.payment_failed',
      id: 'evt_4',
      data: { object: { id: 'pi_3', amount: 100000, currency: 'usd', status: 'failed' } },
    }));

    expect(response.status).toBe(200);
    expect(logEvent).toHaveBeenCalledWith('payment_failed', 'contract', 'c-1', expect.any(Object));
  });

  it('fails closed in production with mock provider (forgery attempt → 503)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    delete process.env.ALLOW_MOCK_PAYMENT_WEBHOOKS;
    try {
      // Mock provider accepts ANY signature — in mock+production this must be
      // rejected before signature verification can even matter.
      const response = await POST(createMockRequest({
        type: 'payment_intent.succeeded',
        id: 'evt_forge',
        data: { object: { id: 'pi_1', amount: 1000, currency: 'usd', status: 'succeeded' } },
      }));

      expect(response.status).toBe(503);
      const data = await response.json();
      expect(data.error).toBe('Payment provider not configured');
      // Ledger must not have been touched
      expect(sql).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('allows mock webhook in production only with explicit ALLOW_MOCK_PAYMENT_WEBHOOKS=1', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ALLOW_MOCK_PAYMENT_WEBHOOKS', '1');
    (sql as any).mockImplementation(async () => []);
    try {
      const response = await POST(createMockRequest({
        type: 'payment_intent.succeeded',
        id: 'evt_optin',
        data: { object: { id: 'pi_9', amount: 1000, currency: 'usd', status: 'succeeded' } },
      }));

      // Guard skipped → request proceeds past provider resolution (404 = no
      // ledger row found in the empty mock DB). Anything but 503 proves the
      // opt-in path works.
      expect(response.status).toBe(404);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
