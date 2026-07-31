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

import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';
import { POST } from './route';
import { resetStripeProvider } from '@/app/api/services/stripeProvider';

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
    resetStripeProvider();
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
    const originalProvider = process.env.STRIPE_PROVIDER;
    process.env.STRIPE_PROVIDER = 'live';
    resetStripeProvider();

    const response = await POST(createMockRequest(
      { type: 'payment_intent.succeeded', id: 'evt_1', data: { object: { id: 'pi_1', amount: 1000, currency: 'usd', status: 'succeeded' } } },
      'invalid'
    ));

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe('Invalid signature');

    process.env.STRIPE_PROVIDER = originalProvider;
    resetStripeProvider();
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
});
