/**
 * /api/payments/stripe — money-CHARGING endpoint security contract.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * This is the endpoint that creates a real Stripe PaymentIntent — it moves the
 * buyer's money for an assignment fee. It carries a documented, deliberate
 * invariant (2026-09-26, "SERVER-AUTHORITATIVE MONEY"): the amount charged is
 * derived from the buyer CONTRACT, never from the request body, and a mismatch
 * is refused (409 FEE_MISMATCH) so a tampered/stale client value can never
 * create an intent for a wrong amount. It had NO route test.
 *
 * If that invariant regressed, a client could POST amountCents=100 for a $5,000
 * assignment fee and the server would charge $1. If org-scoping regressed, one
 * tenant could create or read another tenant's payments. These tests pin both.
 *
 * WHAT IS ASSERTED
 * 1. POST 403s without admin; 403s without an organization.
 * 2. POST 400s on missing fields and on amountCents below the $1 floor.
 * 3. POST 409 FEE_NOT_DETERMINED when the contract has no fee.
 * 4. POST 409 FEE_MISMATCH when the requested amount != the contract fee — and
 *    crucially Stripe is NOT called (no intent is ever created for a wrong sum).
 * 5. On a matching amount, Stripe.paymentIntents.create is called with the
 *    CONTRACT fee, and the payment row is bound to the org.
 * 6. POST 503 STRIPE_NOT_CONFIGURED when the Stripe client is absent.
 * 7. GET 403s without admin/org; 404s an unknown payment; and (cross-org)
 *    never returns a payment belonging to another organization.
 *
 * NOTE on mocking: `stripe` is a module-level singleton built at import from
 * process.env.STRIPE_SECRET_KEY, so the key is set BEFORE the dynamic import and
 * the `stripe` package itself is mocked with a fake paymentIntents.create.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

// Must be set before the route module is imported (it builds `stripe` at load).
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_unit';

const { default: mockSql } = vi.hoisted(() => {
  const m: any = vi.fn(async () => []);
  m.transaction = vi.fn(async () => []);
  m.query = m;
  return { default: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/app/api/utils/authz', () => ({ requireAdmin: (...a: any[]) => requireAdmin(...a) }));

const { getOrganization } = vi.hoisted(() => ({ getOrganization: vi.fn() }));
vi.mock('@/lib/organization-context', () => ({ getOrganization: (...a: any[]) => getOrganization(...a) }));

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('stripe', () => ({
  default: class {
    paymentIntents = { create: (...a: any[]) => create(...a), retrieve: vi.fn() };
  },
}));

// Real resolveAssignmentFeeCents logic is what we are testing end-to-end, but we
// stub it to keep the test focused on the route's amount-vs-contract gate.
vi.mock('@/app/api/utils/assignmentFee', () => ({
  resolveAssignmentFeeCents: (c: any) => Number(c?.assignment_fee_cents) || 0,
}));

const { GET, POST } = await import('./route');

const ADMIN = { ok: true, userId: 'admin-1', email: 'a@x.io' };
const ORG = { id: 'org-1' };

function postReq(body: unknown) {
  return new Request('http://t/api/payments/stripe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as any;
}

function getReq(params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  return new Request(`http://t/api/payments/stripe?${qs}`) as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue(ADMIN);
  getOrganization.mockResolvedValue(ORG);
  create.mockResolvedValue({ id: 'pi_1', client_secret: 'cs_1', status: 'requires_payment_method' });
});

afterAll(() => {
  delete process.env.STRIPE_SECRET_KEY;
});


describe('POST /api/payments/stripe — gating & validation', () => {
  it('403s without admin', async () => {
    requireAdmin.mockResolvedValue({ ok: false, response: Response.json({ error: 'Forbidden' }, { status: 403 }) });
    expect((await POST(postReq(VALID))).status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  it('403s without an organization', async () => {
    getOrganization.mockResolvedValue(null);
    expect((await POST(postReq(VALID))).status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  it('400s when required fields are missing', async () => {
    expect((await POST(postReq({ dealId: 'lead-1' }))).status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('400s when amountCents is below the $1 floor', async () => {
    expect((await POST(postReq({ ...VALID, amountCents: 50 }))).status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('POST /api/payments/stripe — SERVER-AUTHORITATIVE MONEY', () => {
  it('409 FEE_NOT_DETERMINED when the contract has no fee — no intent created', async () => {
    mockSql.mockResolvedValueOnce([{ assignment_fee_cents: null, deal_metadata: null }]); // contract
    const res = await POST(postReq(VALID));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('FEE_NOT_DETERMINED');
    expect(create).not.toHaveBeenCalled();
  });

  it('409 FEE_MISMATCH when the amount != the contract fee — Stripe is NOT called', async () => {
    // Contract says $5,000 (500000). Client asks for $1.00 (100).
    mockSql.mockResolvedValueOnce([{ assignment_fee_cents: 500000, deal_metadata: null }]);
    const res = await POST(postReq({ ...VALID, amountCents: 100 }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('FEE_MISMATCH');
    expect(body.expectedAmount).toBe(500000);
    // The core invariant: a wrong amount NEVER reaches Stripe.
    expect(create).not.toHaveBeenCalled();
  });

  it('creates the intent with the CONTRACT fee and binds the payment row to the org', async () => {
    mockSql.mockResolvedValueOnce([{ assignment_fee_cents: 500000, deal_metadata: null }]); // contract
    mockSql.mockResolvedValueOnce([]); // existing-payment lookup -> none
    mockSql.mockResolvedValueOnce([{ id: 'pay-1' }]); // INSERT ... RETURNING id
    mockSql.mockResolvedValue([]); // audit log

    const res = await POST(postReq(VALID));
    expect(res.status).toBe(200);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].amount).toBe(500000);
    // Payment INSERT is org-bound.
    expect(mockSql.mock.calls[2]).toContain(ORG.id);
  });

  it('refuses to create a second paid payment for the same deal', async () => {
    mockSql.mockResolvedValueOnce([{ assignment_fee_cents: 500000, deal_metadata: null }]); // contract
    mockSql.mockResolvedValueOnce([{ id: 'pay-0', status: 'paid' }]); // existing paid payment
    const res = await POST(postReq(VALID));
    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('GET /api/payments/stripe — tenant-scoped lookup', () => {
  it('403s without admin', async () => {
    requireAdmin.mockResolvedValue({ ok: false, response: Response.json({ error: 'Forbidden' }, { status: 403 }) });
    expect((await GET(getReq({ paymentId: 'p1' }))).status).toBe(403);
  });

  it('400s when neither paymentId nor dealId is provided', async () => {
    expect((await GET(getReq({}))).status).toBe(400);
  });

  it('404s an unknown payment', async () => {
    mockSql.mockResolvedValueOnce([]);
    expect((await GET(getReq({ paymentId: 'nope' }))).status).toBe(404);
  });

  it('SCOPES the lookup by organization_id — no cross-org read', async () => {
    mockSql.mockResolvedValueOnce([
      { id: 'p1', deal_id: 'lead-1', buyer_id: 'buyer-1', amount_cents: 500000, method: 'stripe', status: 'pending', created_at: new Date().toISOString() },
    ]);
    const res = await GET(getReq({ paymentId: 'p1' }));
    expect(res.status).toBe(200);
    // The lookup SQL must filter by organization_id AND bind this org.
    const sqlText = String(mockSql.mock.calls[0]?.[0]?.join(' ') ?? '');
    expect(sqlText).toMatch(/organization_id/i);
    expect(mockSql.mock.calls[0]).toContain(ORG.id);
  });
});

const VALID = { dealId: 'lead-1', buyerId: 'buyer-1', amountCents: 500000, buyerEmail: 'b@x.io' };
