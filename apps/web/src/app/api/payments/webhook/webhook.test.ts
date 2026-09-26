import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — same pattern as the rest of the suite (vi.mock at top).
// ---------------------------------------------------------------------------

vi.mock('@/app/api/utils/sql', () => ({
  default: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/app/api/utils/logger', () => ({
  logEvent: vi.fn(),
}));

vi.mock('@/app/api/utils/jobs', () => ({
  enqueueJob: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/app/api/utils/billingEntitlements', () => ({
  activatePlan: vi.fn(),
  grantCreditPack: vi.fn(),
}));

vi.mock('@/app/api/services/stripeProvider', () => ({
  getStripeProvider: vi.fn().mockReturnValue({
    verifyWebhook: vi.fn().mockReturnValue(true),
    parseWebhookEvent: vi.fn(),
  }),
}));

import sql from '@/app/api/utils/sql';
import { getStripeProvider } from '@/app/api/services/stripeProvider';
import { activatePlan, grantCreditPack } from '@/app/api/utils/billingEntitlements';
import { logEvent } from '@/app/api/utils/logger';
import { POST } from './route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWebhookBody(eventType: string, params: Record<string, unknown> = {}): string {
  const payload = {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    object: 'event',
    api_version: '2024-06-20',
    type: eventType,
    data: {
      object: {
        id: `pi_${Math.random().toString(36).slice(2)}`,
        object: 'charge',
        amount: 4900,
        currency: 'usd',
        ...params,
      },
    },
  };
  return JSON.stringify(payload);
}

function makeRequest(body: string, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/payments/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': headers['stripe-signature'] || '',
      ...headers,
    },
    body,
  });
}

function setEnv(overrides: Record<string, string | undefined>) {
  const defaults: Record<string, string | undefined> = {
    STRIPE_SECRET_KEY: undefined,
    STRIPE_PROVIDER: 'mock',
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
    ALLOW_MOCK_PAYMENT_WEBHOOKS: undefined,
    NODE_ENV: 'testing',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/testdb',
  };
  for (const [k, v] of Object.entries(defaults)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  setEnv({});
  (getStripeProvider as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    verifyWebhook: vi.fn().mockReturnValue(true),
    parseWebhookEvent: vi.fn(),
  });
  (sql as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (activatePlan as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    planTier: 'pro',
    creditsGranted: 500,
    alreadyProcessed: false,
  });
  (grantCreditPack as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    creditsGranted: 1000,
    alreadyProcessed: false,
  });
});

afterEach(() => {
  vi.resetAllMocks();
  setEnv({});
});

// ---------------------------------------------------------------------------
// Production guard — mock mode + production + no opt-in → 503
// ---------------------------------------------------------------------------

describe('POST /api/payments/webhook — production mock guard', () => {
  it('returns 503 when mock mode is active in production without opt-in', async () => {
    setEnv({ NODE_ENV: 'production' });

    const req = makeRequest(makeWebhookBody('payment_intent.succeeded'));
    const res = await POST(req);

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toBe('Payment provider not configured');
  });

  it('allows mock webhooks in production when ALLOW_MOCK_PAYMENT_WEBHOOKS=1', async () => {
    setEnv({
      NODE_ENV: 'production',
      ALLOW_MOCK_PAYMENT_WEBHOOKS: '1',
    });

    // Mock provider parses the event.
    (getStripeProvider as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      verifyWebhook: vi.fn().mockReturnValue(true),
      parseWebhookEvent: vi.fn().mockReturnValue({
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_1', amount: 4900 } },
      }),
    });

    const req = makeRequest(makeWebhookBody('payment_intent.succeeded'));
    const res = await POST(req);

    expect(res.status).toBeLessThan(500); // not blocked
  });
});

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

describe('POST /api/payments/webhook — signature verification', () => {
  it('returns 403 for an invalid signature', async () => {
    (getStripeProvider as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      verifyWebhook: vi.fn().mockReturnValue(false),
      parseWebhookEvent: vi.fn(),
    });

    const req = makeRequest(
      makeWebhookBody('payment_intent.succeeded'),
      { 'stripe-signature': 'invalid' },
    );
    const res = await POST(req);

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('Invalid signature');
  });
});

// ---------------------------------------------------------------------------
// payment_intent events — current behaviour
// ---------------------------------------------------------------------------

describe('POST /api/payments/webhook — payment_intent events', () => {
  it('marks a succeeded payment as paid when amount matches', async () => {
    const contractId = 'c6ad1406-6a44-4b9e-b8c4-1e1651b09d73';
    (sql as unknown as ReturnType<typeof vi.fn>)
      // 1. idempotency check (not yet processed)
      .mockResolvedValueOnce([])
      // 2. ledger lookup → row with matching amount
      .mockResolvedValueOnce([{ id: crypto.randomUUID(), contract_id: contractId, amount_cents: 4900, status: 'sent', organization_id: 'org_test' }])
      // 3. UPDATE payments_ledger SET status = 'paid'
      .mockResolvedValueOnce([{ rowCount: 1 }]);

    const provider = getStripeProvider();
    (provider.parseWebhookEvent as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_test', amount: 4900 } },
    });

    const req = makeRequest(makeWebhookBody('payment_intent.succeeded'));
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);

    // sql calls: idempotency check + ledger lookup + status update
    expect(sql).toHaveBeenCalledTimes(3);
  });

  it('holds a succeeded payment (no auto-mark) when amount does not match', async () => {
    (sql as unknown as ReturnType<typeof vi.fn>)
      // 1. idempotency check (not yet processed)
      .mockResolvedValueOnce([])
      // 2. ledger lookup → row with mismatched amount
      .mockResolvedValueOnce([{ id: crypto.randomUUID(), contract_id: 'c1', amount_cents: 9900, status: 'sent', organization_id: 'org_test' }]);

    const provider = getStripeProvider();
    (provider.parseWebhookEvent as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_test', amount: 4900 } }, // 49.00 — mismatch
    });

    const req = makeRequest(makeWebhookBody('payment_intent.succeeded'));
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
    expect(json.held).toBe(true);

    // sql calls: idempotency check + ledger lookup; no status update (held)
    expect(sql).toHaveBeenCalledTimes(2);
  });

  it('marks a payment_intent.payment_failed as failed', async () => {
    const contractId = 'c6ad1406-6a44-4b9e-b8c4-1e1651b09d73';
    (sql as unknown as ReturnType<typeof vi.fn>)
      // 1. idempotency check (not yet processed)
      .mockResolvedValueOnce([])
      // 2. ledger lookup
      .mockResolvedValueOnce([{ id: crypto.randomUUID(), contract_id: contractId, amount_cents: 4900, status: 'sent', organization_id: 'org_test' }])
      // 3. UPDATE payments_ledger SET status = 'failed'
      .mockResolvedValueOnce([{ rowCount: 1 }]);

    const provider = getStripeProvider();
    (provider.parseWebhookEvent as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      type: 'payment_intent.payment_failed',
      data: { object: { id: 'pi_fail', amount: 4900 } },
    });

    const req = makeRequest(makeWebhookBody('payment_intent.payment_failed'));
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
  });

  it('marks a payment_intent.refunded as refunded', async () => {
    (sql as unknown as ReturnType<typeof vi.fn>)
      // 1. idempotency check (not yet processed)
      .mockResolvedValueOnce([])
      // 2. ledger lookup
      .mockResolvedValueOnce([{ id: crypto.randomUUID(), contract_id: 'c1', amount_cents: 4900, status: 'paid', organization_id: 'org_test' }])
      // 3. UPDATE payments_ledger SET status = 'refunded'
      .mockResolvedValueOnce([{ rowCount: 1 }]);

    const provider = getStripeProvider();
    (provider.parseWebhookEvent as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      type: 'payment_intent.refunded',
      data: { object: { id: 'pi_refund', amount: 4900 } },
    });

    const req = makeRequest(makeWebhookBody('payment_intent.refunded'));
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
  });

  it('ignores unknown event types gracefully', async () => {
    const provider = getStripeProvider();
    (provider.parseWebhookEvent as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      type: 'account.updated',
      data: { object: {} },
    });

    const req = makeRequest(makeWebhookBody('account.updated'));
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
    // Unknown events are short-circuited before any ledger SQL.
    expect(sql).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Replay + duplicate-PI safety (the retry-storm fix)
// ---------------------------------------------------------------------------

describe('POST /api/payments/webhook - replay + duplicate-PI safety', () => {
  it('acknowledges an already-processed event without re-running ledger SQL', async () => {
    (sql as unknown as ReturnType<typeof vi.fn>)
      // 1. idempotency check: this event id is already recorded on a ledger row
      .mockResolvedValueOnce([{ ok: 1 }]);

    const provider = getStripeProvider();
    (provider.parseWebhookEvent as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_test', amount: 4900 } },
    });

    const req = makeRequest(makeWebhookBody('payment_intent.succeeded'));
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.received).toBe(true);
    expect(json.idempotent).toBe(true);
    expect(sql).toHaveBeenCalledTimes(1);
  });

  it('acknowledges the duplicate billing payment_intent.succeeded instead of 404-ing', async () => {
    (sql as unknown as ReturnType<typeof vi.fn>)
      // 1. idempotency check: not yet processed
      .mockResolvedValueOnce([])
      // 2. ledger lookup: no ledger row - this money belongs to a billing
      //    checkout already provisioned by checkout.session.completed
      .mockResolvedValueOnce([]);

    const provider = getStripeProvider();
    (provider.parseWebhookEvent as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_billing',
          amount: 4900,
          metadata: { plan_id: 'pro', organization_id: 'org-1' },
        },
      },
    });

    const req = makeRequest(
      makeWebhookBody('payment_intent.succeeded', {
        metadata: { plan_id: 'pro', organization_id: 'org-1' },
      })
    );
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.received).toBe(true);
    expect(json.handledBy).toBe('checkout.session.completed');
  });
});

// ---------------------------------------------------------------------------
// charge.refunded - ledger refund
// ---------------------------------------------------------------------------

describe('POST /api/payments/webhook — charge.refunded', () => {
  it('marks the paid ledger entry refunded and logs payment_refunded', async () => {
    const contractId = 'c6ad1406-6a44-4b9e-b8c4-1e1651b09d73';
    (sql as unknown as ReturnType<typeof vi.fn>)
      // 1. idempotency check (not yet processed)
      .mockResolvedValueOnce([])
      // 2. ledger lookup → row with paid status
      .mockResolvedValueOnce([{ id: crypto.randomUUID(), contract_id: contractId, amount_cents: 4900, status: 'paid', organization_id: 'org_test' }])
      // 3. UPDATE payments_ledger SET status = 'refunded'
      .mockResolvedValueOnce([{ rowCount: 1 }]);

    const provider = getStripeProvider();
    (provider.parseWebhookEvent as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      type: 'charge.refunded',
      data: { object: { id: 'ch_refund', amount: 4900 } },
    });

    const req = makeRequest(makeWebhookBody('charge.refunded'));
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
    expect(sql).toHaveBeenCalledTimes(3);
    // The refund is auditable, and the old contract best_price logic is gone.
    expect(logEvent).toHaveBeenCalledWith(
      'payment_refunded',
      'contract',
      contractId,
      expect.objectContaining({ paymentIntentId: expect.any(String) })
    );
  });
});

// ---------------------------------------------------------------------------
// checkout.session.completed - the grant path
// ---------------------------------------------------------------------------

describe('POST /api/payments/webhook - checkout.session.completed', () => {
  const SESSION = {
    id: 'cs_test_123',
    object: 'checkout.session',
    mode: 'payment',
    customer: 'cus_test',
    amount_total: 4900,
    currency: 'usd',
    payment_status: 'paid',
  };

  function mockCheckoutEvent(metadata: Record<string, string>) {
    const provider = getStripeProvider();
    (provider.parseWebhookEvent as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'evt_checkout',
      object: 'event',
      type: 'checkout.session.completed',
      data: { object: { ...SESSION, metadata } },
    });
  }

  function makeCheckoutRequest(metadata: Record<string, string>) {
    return makeRequest(
      JSON.stringify({
        id: 'evt_checkout',
        object: 'event',
        type: 'checkout.session.completed',
        data: { object: { ...SESSION, metadata } },
      }),
      { 'stripe-signature': 't=123,v1=abc' }
    );
  }

  it('activates the purchased plan when the session is paid and attributed', async () => {
    mockCheckoutEvent({ organization_id: 'org-1', plan_id: 'pro' });
    const res = await POST(makeCheckoutRequest({ organization_id: 'org-1', plan_id: 'pro' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.received).toBe(true);
    expect(json.granted).toBe(true);
    expect(json.kind).toBe('plan');
    expect(json.plan).toBe('pro');
    expect(json.creditsGranted).toBe(500);

    expect(activatePlan).toHaveBeenCalledTimes(1);
    expect(activatePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        planId: 'pro',
        processorReference: 'cs_test_123',
        stripeCustomerId: 'cus_test',
        amountCents: 4900,
        status: 'active',
      })
    );
    // A plan purchase never grants a credit pack on the side, and the grant
    // path must not fall through to contract-ledger SQL.
    expect(grantCreditPack).not.toHaveBeenCalled();
    expect(sql).not.toHaveBeenCalled();
  });

  it('grants the purchased credit pack from the DB pack row, never from the amount', async () => {
    (sql as unknown as ReturnType<typeof vi.fn>)
      // resolvePackCredits: SELECT credits FROM credit_packs WHERE id = ...
      .mockResolvedValueOnce([{ credits: 1000 }]);

    mockCheckoutEvent({ organization_id: 'org-1', credit_pack_id: '1000' });
    const res = await POST(
      makeCheckoutRequest({ organization_id: 'org-1', credit_pack_id: '1000' })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.received).toBe(true);
    expect(json.granted).toBe(true);
    expect(json.kind).toBe('credit_pack');
    expect(json.creditsGranted).toBe(1000);

    expect(grantCreditPack).toHaveBeenCalledTimes(1);
    expect(grantCreditPack).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        credits: 1000,
        amountCents: 4900,
        packId: '1000',
        idempotencyKey: 'credit-pack:evt_checkout',
        stripeCustomerId: 'cus_test',
      })
    );
    expect(activatePlan).not.toHaveBeenCalled();
  });

  it('acknowledges an unsettled session without granting anything', async () => {
    const provider = getStripeProvider();
    (provider.parseWebhookEvent as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          ...SESSION,
          id: 'cs_unpaid',
          payment_status: 'unpaid',
          metadata: { organization_id: 'org-1', plan_id: 'pro' },
        },
      },
    });

    const res = await POST(
      makeRequest(
        JSON.stringify({
          id: 'evt_unpaid',
          object: 'event',
          type: 'checkout.session.completed',
          data: { object: { id: 'cs_unpaid', payment_status: 'unpaid' } },
        }),
        { 'stripe-signature': 't=123,v1=abc' }
      )
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.received).toBe(true);
    expect(json.awaitingPayment).toBe(true);
    expect(activatePlan).not.toHaveBeenCalled();
    expect(grantCreditPack).not.toHaveBeenCalled();
  });

  it('does not grant when a PAID session cannot be attributed', async () => {
    mockCheckoutEvent({});
    const res = await POST(makeCheckoutRequest({}));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.received).toBe(true);
    expect(json.granted).toBe(false);
    expect(json.reason).toBe('missing_metadata');
    expect(activatePlan).not.toHaveBeenCalled();
    expect(grantCreditPack).not.toHaveBeenCalled();
    // Loud alert for manual reconciliation.
    expect(logEvent).toHaveBeenCalledWith(
      'billing_webhook_unattributable',
      'billing',
      'unknown',
      expect.objectContaining({ sessionId: 'cs_test_123', reason: 'missing_metadata' })
    );
  });

  it('does not guess credits for an unknown pack without a signed credits value', async () => {
    (sql as unknown as ReturnType<typeof vi.fn>)
      // resolvePackCredits: no credit_packs row for this id
      .mockResolvedValueOnce([]);

    mockCheckoutEvent({ organization_id: 'org-1', credit_pack_id: 'ghost-pack' });
    const res = await POST(
      makeCheckoutRequest({ organization_id: 'org-1', credit_pack_id: 'ghost-pack' })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.received).toBe(true);
    expect(json.granted).toBe(false);
    expect(json.reason).toBe('unknown_credit_pack');
    expect(grantCreditPack).not.toHaveBeenCalled();
  });
});
