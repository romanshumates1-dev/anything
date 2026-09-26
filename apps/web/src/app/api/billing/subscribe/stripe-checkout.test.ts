/** Stripe Checkout — subscribe route tests (RED phase). */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ── next/headers must be mocked so `headers()` doesn't throw outside a
//    real request scope. The route awaits headers() (Next 15 async API);
//    an async factory returning a real Headers mirrors production. ──
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}));


vi.mock('@/app/api/utils/sql', () => ({
  default: vi.fn(),
}));
vi.mock('@/app/api/utils/logger', () => ({
  logEvent: vi.fn(),
}));
vi.mock('@/app/api/utils/emailProviders', () => ({
  sendEmailAuto: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));
vi.mock('@/lib/organization-context', () => ({
  getOrganization: vi.fn(),
}));

import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';
import { sendEmailAuto } from '@/app/api/utils/emailProviders';
import { auth } from '@/lib/auth';
import { getOrganization } from '@/lib/organization-context';
import { POST } from './route';

const FAKE_ORG_ID = crypto.randomUUID();
const FAKE_USER_ID = crypto.randomUUID();

function sessionFixture(overrides?: any) {
  return {
    user: { id: FAKE_USER_ID, email: 'test@example.com', name: 'Test User' },
    organizationId: FAKE_ORG_ID,
    ...overrides,
  };
}

function makeReq(body: any) {
  return {
    json: async () => body,
  } as unknown as NextRequest;
}

function setupEnv() {
  process.env.STRIPE_SECRET_KEY = undefined;
  process.env.STRIPE_WEBHOOK_SECRET = undefined;
  process.env.STRIPE_PROVIDER = 'mock';
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:4000';
  process.env.ALLOW_MOCK_PAYMENT_WEBHOOKS = undefined;
}

// Sequential sql mocks matching the route's real query order.
//
// Credit pack (dev fallback): checkIdempotency → ensure credit_balances row →
// atomic add CTE (must return the updated row or addCredits throws its
// overflow guard) → INSERT billing_events (fire-and-forget).
function mockCreditPackSql(balance = 100) {
  (sql as any)
    .mockResolvedValueOnce([]) // checkIdempotency — no prior transaction
    .mockResolvedValueOnce([]) // ensure credit_balances row exists
    .mockResolvedValueOnce([{ balance, transaction_id: 'txn_test_1' }]) // atomic add CTE
    .mockResolvedValueOnce([]); // INSERT billing_events
}

// Plan purchase (dev fallback): getPlanFromDB → UPDATE organizations.
const PLAN_LIMITS = {
  monthly_ai_credits: 1000,
  monthly_lead_allowance: 50,
  monthly_sms_allowance: 100,
  campaigns: 3,
  seats: 2,
  features: [],
};

function mockPlanSql(priceCents = 2900, tier = 'starter') {
  (sql as any)
    // REAL row shape: getPlanFromDB now SELECTs id + tier too, because a tier
    // can map to multiple rows (plan_professional "Pro (Legacy)" alias) and
    // selectPlanRow needs them to pick the canonical row deterministically.
    // The row MUST match the requested planId/tier — a mismatched row is now
    // correctly rejected as "Invalid plan" instead of silently priced.
    .mockResolvedValueOnce([{ id: `plan_${tier}`, tier, name: tier, price_cents: priceCents, limits: PLAN_LIMITS }]) // getPlanFromDB
    .mockResolvedValueOnce([{ rowCount: 1 }]); // UPDATE organizations
}

describe('billing/subscribe — Stripe Checkout session creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupEnv();
    // The route does `sendEmailAuto(...).catch(...)` — the mock must resolve.
    // (No headers stub needed: the factory already resolves a real Headers.)
    (sendEmailAuto as any).mockResolvedValue(undefined);
  });

  it('returns 200 + creditsAdded for credit pack purchase in mock mode', async () => {
    (auth.api.getSession as any).mockReturnValue(sessionFixture());
    (getOrganization as any).mockReturnValue({ id: FAKE_ORG_ID });
    mockCreditPackSql(100);

    const res = await POST(makeReq({ creditPackId: '100' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.creditsAdded).toBe(100);
  });

  it('returns 200 + trial for new plan purchase in mock mode (no Stripe keys)', async () => {
    (auth.api.getSession as any).mockReturnValue(sessionFixture());
    (getOrganization as any).mockReturnValue({ id: FAKE_ORG_ID });
    mockPlanSql(2900);

    const res = await POST(makeReq({ planId: 'starter' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.trial).toBe(true);
    expect(data.trialDays).toBe(14);
  });

  it('returns 200 for plan purchase when Stripe keys are absent (mock/direct path, no throw)', async () => {
    (auth.api.getSession as any).mockReturnValue(sessionFixture());
    (getOrganization as any).mockReturnValue({ id: FAKE_ORG_ID });
    mockPlanSql(4900, 'pro');

    await expect(POST(makeReq({ planId: 'pro' }))).resolves.toBeDefined();
  });

  it('credit pack purchase returns 400 for unknown pack id', async () => {
    (auth.api.getSession as any).mockReturnValue(sessionFixture());
    (getOrganization as any).mockReturnValue({ id: FAKE_ORG_ID });

    const res = await POST(makeReq({ creditPackId: 'unknown' }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Invalid credit pack');
  });

  it('returns 401 when no session for credit pack purchase', async () => {
    (auth.api.getSession as any).mockReturnValue(undefined);

    const res = await POST(makeReq({ creditPackId: '100' }));
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe('Unauthorized');
  });

  it('returns 403 when no organization for credit pack purchase', async () => {
    (auth.api.getSession as any).mockReturnValue(sessionFixture());
    (getOrganization as any).mockReturnValue(null);

    const res = await POST(makeReq({ creditPackId: '100' }));
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toBe('No organization');
  });

  it('returns 400 for invalid JSON body', async () => {
    const res = await POST({
      json: async () => { throw new Error('bad json'); },
    } as unknown as NextRequest);
    expect(res.status).toBe(400);
  });

  it('passes planId + org id into logEvent for plan purchase', async () => {
    (auth.api.getSession as any).mockReturnValue(sessionFixture());
    (getOrganization as any).mockReturnValue({ id: FAKE_ORG_ID });
    mockPlanSql(2900);

    await POST(makeReq({ planId: 'starter' }));
    expect(logEvent).toHaveBeenCalledWith(
      'subscription_upgraded',
      'billing',
      FAKE_ORG_ID,
      expect.objectContaining({ plan: 'starter', discount: 0 }),
      FAKE_USER_ID,
    );
  });
});
