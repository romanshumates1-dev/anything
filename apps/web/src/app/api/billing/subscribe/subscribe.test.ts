/**
 * POST /api/billing/subscribe — unit tests.
 *
 * Mocks mirror the REAL production dependency graph of subscribe/route.ts:
 *
 *   @/app/api/utils/sql              → default tagged-template query fn
 *   @/lib/auth                       → `auth = betterAuth({...})`; route calls
 *                                      auth.api.getSession({ headers })
 *   better-auth                      → exports `betterAuth` (factory). lib/auth
 *                                      calls it at module scope, so the mock
 *                                      must export the FACTORY, not an `auth`.
 *   next/headers                     → headers() (request scope; both the route
 *                                      and organization-context call it)
 *   @/lib/organization-context       → REAL module (getOrganization); resolves
 *                                      via auth.api.getSession + sql
 *   @/app/api/utils/logger           → logEvent
 *   @/app/api/utils/emailProviders   → sendEmailAuto (utils/email does NOT
 *                                      exist — the old mock targeted it)
 *   @/app/api/utils/credits          → addCredits (ledger CTE; has its own
 *                                      suite — credits.test.ts)
 *   @/app/api/services/stripeProvider→ getStripeProvider({ type }) returning a
 *                                      provider whose createBillingCheckoutSession
 *                                      resolves { checkoutUrl }. The route does
 *                                      NOT import 'stripe' or 'stripeClient'.
 *   @/app/api/utils/appUrl           → REAL module (validates NEXT_PUBLIC_APP_URL)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { POST as subscribePost } from './route';

// Hoisted mock singletons so vi.mock factories (hoisted above consts) can
// reference them.
const { betterAuthInstance, createBillingCheckoutSession } = vi.hoisted(() => ({
  betterAuthInstance: {
    api: { getSession: vi.fn() },
    // lib/auth.ts does `export type Session = typeof auth.$Infer.Session` —
    // type-position only, so the runtime value can be an empty object.
    $Infer: {},
  },
  createBillingCheckoutSession: vi.fn(),
}));

// sql — controlled stub; every call returns [] by default so routes that read
// rows see "not found" unless overridden with mockResolvedValueOnce.
vi.mock('@/app/api/utils/sql', () => ({
  default: vi.fn().mockResolvedValue([]),
}));

// logger — no-op in tests; we only assert HTTP responses.
vi.mock('@/app/api/utils/logger', () => ({
  logEvent: vi.fn(),
}));

// email — REAL module path the route imports (emailProviders.ts exports
// sendEmailAuto(orgId, options) → { success, provider, messageId?, error? }).
vi.mock('@/app/api/utils/emailProviders', () => ({
  sendEmailAuto: vi.fn().mockResolvedValue({ success: true, provider: 'mock' }),
}));

// credits — the route calls the authoritative addCredits ledger in the dev/test
// fallback path. The ledger's SQL semantics are covered by credits.test.ts, so
// the route-level tests mock the exact interface: (orgId, credits, source,
// description, metadata, idempotencyKey) → { success, balance }.
vi.mock('@/app/api/utils/credits', () => ({
  addCredits: vi.fn().mockResolvedValue({ success: true, balance: 100 }),
}));

// better-auth — the real package exports the `betterAuth` FACTORY and
// lib/auth.ts calls it at module scope. The factory returns the instance whose
// `api.getSession` both the route and organization-context consume.
vi.mock('better-auth', () => ({
  betterAuth: vi.fn(() => betterAuthInstance),
}));

// next/headers — the route and organization-context call `await headers()`
// inside the request scope; outside Next's runtime this must be mocked.
vi.mock('next/headers', () => ({
  headers: vi.fn(() => new Headers()),
}));

// stripeProvider — the route builds checkouts through the provider abstraction:
// getStripeProvider({ type }) → provider.createBillingCheckoutSession(params)
// → { checkoutUrl }. (The old test doMocked '@/app/api/services/stripeClient',
// a module this route never imports.)
vi.mock('@/app/api/services/stripeProvider', () => ({
  getStripeProvider: vi.fn(() => ({
    createBillingCheckoutSession,
    verifyWebhook: vi.fn().mockReturnValue(true),
    parseWebhookEvent: vi.fn(),
  })),
}));

import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { getStripeProvider } from '@/app/api/services/stripeProvider';
import { sendEmailAuto } from '@/app/api/utils/emailProviders';
import { addCredits } from '@/app/api/utils/credits';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(
  body: Record<string, unknown> | string,
  opts: {
    cookie?: string;
    env?: Record<string, string | undefined>;
  } = {},
): NextRequest {
  const url = new URL('http://localhost/api/billing/subscribe');
  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  if (opts.cookie) headers.set('Cookie', opts.cookie);
  return new NextRequest(url.toString(), {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** Reset process.env to a clean mock-mode baseline before each test. */
function setEnv(overrides: Record<string, string | undefined>) {
  const defaults: Record<string, string | undefined> = {
    NODE_ENV: 'test',
    STRIPE_SECRET_KEY: undefined,
    STRIPE_PROVIDER: 'mock',
    STRIPE_WEBHOOK_SECRET: undefined,
    NEXT_PUBLIC_APP_URL: 'http://localhost:4000',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/testdb',
    BETTER_AUTH_URL: 'http://localhost:4000',
    BETTER_AUTH_SECRET: 'test-secret',
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

/** A signed-in session stub (the shape better-auth returns). */
const fakeSession = {
  user: { id: 'user-1', email: 'alice@example.com', name: 'Alice' },
  organization: { id: 'org-1' },
  access_token: 'tok-1',
};

/**
 * A subscription_plans row stub — the REAL shape consumed by getPlanFromDB:
 * { name, price_cents, limits: { monthly_ai_credits, monthly_lead_allowance,
 * monthly_sms_allowance, campaigns, seats, features } }.
 */
const fakePlan = {
  tier: 'pro',
  name: 'Pro',
  price_cents: 4900,
  limits: {
    monthly_ai_credits: 500,
    monthly_lead_allowance: 500,
    monthly_sms_allowance: 1000,
    campaigns: 50,
    seats: 5,
    features: ['ai_negotiation', 'sms_outreach'],
  },
};

/** A membership row — what getOrganization's first query returns. */
const fakeMembership = { organization_id: 'org-1', name: 'Acme', slug: 'acme' };

beforeEach(() => {
  vi.clearAllMocks();
  setEnv({ STRIPE_PROVIDER: 'mock' });
  // Default DB: no rows anywhere (reads fail "not found").
  (sql as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  // Auth: a signed-in session by default.
  betterAuthInstance.api.getSession.mockResolvedValue(fakeSession);
  // Provider: a healthy checkout session by default.
  createBillingCheckoutSession.mockResolvedValue({
    checkoutUrl: 'https://checkout.stripe.com/test_session',
  });
  (getStripeProvider as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
    createBillingCheckoutSession,
    verifyWebhook: vi.fn().mockReturnValue(true),
    parseWebhookEvent: vi.fn(),
  }));
  (sendEmailAuto as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    success: true,
    provider: 'mock',
  });
  (addCredits as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    success: true,
    balance: 100,
  });
});

afterEach(() => {
  vi.resetAllMocks();
  setEnv({});
});

// ---------------------------------------------------------------------------
// Mock mode (no Stripe configured, NODE_ENV !== 'production')
// ---------------------------------------------------------------------------

describe('POST /api/billing/subscribe — mock mode (no Stripe keys)', () => {
  it('grants a credit pack through the authoritative ledger and returns 200', async () => {
    // 1. getOrganization membership lookup. addCredits is mocked (no sql).
    // 2. billing_events INSERT.
    (sql as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([fakeMembership])
      .mockResolvedValueOnce([{ id: crypto.randomUUID() }]);

    // Pack ids are the route's canonical CREDIT_PACKS keys ('100' | '500' |
    // '1000' | '5000') — the old 'pack_100' id never existed.
    const req = makeRequest({ creditPackId: '100' });
    const res = await subscribePost(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.creditsAdded).toBe(100);
    expect(json.newBalance).toBe(100);

    // Credits flow through the ledger util, keyed to the organization — never
    // written by hand from the request body.
    expect(addCredits).toHaveBeenCalledTimes(1);
    expect(addCredits).toHaveBeenCalledWith(
      'org-1',
      100,
      'PURCHASE',
      expect.stringContaining('100'),
      expect.objectContaining({ packId: '100' }),
      expect.any(String),
    );
    expect(sendEmailAuto).not.toHaveBeenCalled();

    // sql: membership lookup + billing_events insert.
    expect(sql).toHaveBeenCalledTimes(2);
  });

  it('returns 400 for an unknown credit pack', async () => {
    // getOrganization runs BEFORE pack validation, so membership must resolve.
    (sql as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([fakeMembership]);

    const req = makeRequest({ creditPackId: 'does-not-exist' });
    const res = await subscribePost(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Invalid credit pack');
    expect(addCredits).not.toHaveBeenCalled();
  });

  it('returns 401 on a credit-pack purchase without a session', async () => {
    betterAuthInstance.api.getSession.mockResolvedValue(null);

    const req = makeRequest({ creditPackId: '100' });
    const res = await subscribePost(req);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toBe('Unauthorized');
    expect(addCredits).not.toHaveBeenCalled();
  });

  it('activates a subscription plan directly in dev/test and returns 200', async () => {
    // 1. getPlanFromDB (runs before the session check).
    // 2. getOrganization membership lookup.
    // 3. UPDATE organizations.
    (sql as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([fakePlan])
      .mockResolvedValueOnce([fakeMembership])
      .mockResolvedValueOnce([{ rowCount: 1 }]);

    const req = makeRequest({ planId: 'pro' });
    const res = await subscribePost(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.plan).toBe('pro');
    expect(json.price).toBe(49); // 4900 cents → dollars
    expect(json.trial).toBe(true);
    expect(json.trialDays).toBe(14);
    expect(json.checkoutUrl).toBeUndefined();

    // The dev/test confirmation email goes to the session's user.
    expect(sendEmailAuto).toHaveBeenCalledTimes(1);
    expect(sendEmailAuto).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ to: 'alice@example.com' }),
    );
  });

  it('returns 400 for an unknown plan', async () => {
    (sql as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]); // no plan row

    const req = makeRequest({ planId: 'does-not-exist' });
    const res = await subscribePost(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Invalid plan');
  });

  it('returns 403 when the user has no organization', async () => {
    // Plan row exists; membership + org_default lookups return nothing, so
    // getOrganization resolves null.
    (sql as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([fakePlan]);

    const req = makeRequest({ planId: 'pro' });
    const res = await subscribePost(req);
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toBe('No organization');
  });

  it('applies the LAUNCH50 promo code and halves the price', async () => {
    (sql as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([fakePlan])
      .mockResolvedValueOnce([fakeMembership])
      .mockResolvedValueOnce([{ rowCount: 1 }]);

    const req = makeRequest({ planId: 'pro', promoCode: 'LAUNCH50' });
    const res = await subscribePost(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    // 49 dollars * 0.5, rounded → 25.
    expect(json.price).toBe(25);
    expect(json.success).toBe(true);
  });

  it('returns 409 when a new-user signup email already exists', async () => {
    betterAuthInstance.api.getSession.mockResolvedValue(null);
    // getPlanFromDB runs before the new-signup branch, so queue the plan row
    // first; the existing-user lookup consumes the second result.
    (sql as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([fakePlan])
      .mockResolvedValueOnce([{ id: 'existing-user' }]);

    const req = makeRequest({
      planId: 'pro',
      email: 'existing@example.com',
      password: 'password123',
    });
    const res = await subscribePost(req);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toBe('Account exists');
  });

  it('returns 400 for malformed JSON', async () => {
    const req = makeRequest('{not json');
    const res = await subscribePost(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Invalid JSON');
  });

  it('returns 503 instead of granting a paid plan in production without usable Stripe config', async () => {
    setEnv({ NODE_ENV: 'production', STRIPE_PROVIDER: 'mock' });
    (sql as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([fakePlan])
      .mockResolvedValueOnce([fakeMembership]);

    const req = makeRequest({ planId: 'pro' });
    const res = await subscribePost(req);
    const json = await res.json();

    expect(res.status).toBe(503);
    expect(json.error).toBe('Payment processing is not configured');
    expect(json.code).toBe('PAYMENT_NOT_CONFIGURED');
  });

  it('still completes activation when the confirmation email fails', async () => {
    (sendEmailAuto as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('smtp down'),
    );
    (sql as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([fakePlan])
      .mockResolvedValueOnce([fakeMembership])
      .mockResolvedValueOnce([{ rowCount: 1 }]);

    const req = makeRequest({ planId: 'pro' });
    const res = await subscribePost(req);
    const json = await res.json();

    // Email failure is fire-and-forget (.catch) and must not corrupt the
    // activation result.
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
  });

  it('propagates database failures instead of silently succeeding', async () => {
    (sql as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('connection reset'),
    );

    const req = makeRequest({ planId: 'pro' });
    // The plan branch does not wrap getPlanFromDB in try/catch; the framework
    // converts the rejection into a 500. Assert no fake success is returned.
    await expect(subscribePost(req)).rejects.toThrow('connection reset');
  });
});

// ---------------------------------------------------------------------------
// Live mode (STRIPE_PROVIDER=live + key + webhook secret)
// ---------------------------------------------------------------------------

describe('POST /api/billing/subscribe — live mode (Stripe keys present)', () => {
  it('creates a Stripe Checkout session and returns the checkout URL', async () => {
    setEnv({
      NODE_ENV: 'test',
      STRIPE_SECRET_KEY: 'sk_live_abc',
      STRIPE_PROVIDER: 'live',
      STRIPE_WEBHOOK_SECRET: 'whsec_xyz',
    });
    // 1. getPlanFromDB. 2. getOrganization. 3. getStripeCustomerId.
    (sql as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([fakePlan])
      .mockResolvedValueOnce([fakeMembership])
      .mockResolvedValueOnce([{ stripe_customer_id: 'cus_existing' }]);

    // `price` in the body must be ignored — the amount always comes from the
    // server-side plan row.
    const req = makeRequest({ planId: 'pro', price: 1 });
    const res = await subscribePost(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.requiresPayment).toBe(true);
    expect(json.checkoutUrl).toBe('https://checkout.stripe.com/test_session');
    // No trial semantics when paying through Checkout.
    expect(json.trial).toBeUndefined();

    // Server-controlled amount (from subscription_plans), existing Stripe
    // customer reuse, and checkout return URLs pointing at the billing page.
    expect(createBillingCheckoutSession).toHaveBeenCalledTimes(1);
    const params = createBillingCheckoutSession.mock.calls[0][0];
    expect(params.organizationId).toBe('org-1');
    expect(params.userId).toBe('user-1');
    expect(params.planId).toBe('pro');
    expect(params.amountCents).toBe(4900);
    expect(params.customerEmail).toBe('alice@example.com');
    expect(params.stripeCustomerId).toBe('cus_existing');
    expect(params.successUrl).toContain('/settings/billing?checkout=success');
    expect(params.cancelUrl).toContain('/settings/billing?checkout=cancelled');
  });

  it('sends a credit-pack purchase to checkout instead of granting credits', async () => {
    setEnv({
      NODE_ENV: 'test',
      STRIPE_SECRET_KEY: 'sk_live_abc',
      STRIPE_PROVIDER: 'live',
      STRIPE_WEBHOOK_SECRET: 'whsec_xyz',
    });
    // 1. getOrganization. 2. getStripeCustomerId.
    (sql as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([fakeMembership])
      .mockResolvedValueOnce([{ stripe_customer_id: null }]);

    const req = makeRequest({ creditPackId: '100' });
    const res = await subscribePost(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.requiresPayment).toBe(true);
    expect(json.checkoutUrl).toBe('https://checkout.stripe.com/test_session');
    expect(json.creditsAdded).toBe(0);
    // Nothing granted synchronously — the verified webhook grants credits.
    expect(addCredits).not.toHaveBeenCalled();
    const params = createBillingCheckoutSession.mock.calls[0][0];
    expect(params.creditPackId).toBe('100');
    expect(params.amountCents).toBe(500); // pack '100' → $5.00
  });

  it('returns 502 when the checkout session cannot be created', async () => {
    setEnv({
      NODE_ENV: 'test',
      STRIPE_SECRET_KEY: 'sk_live_abc',
      STRIPE_PROVIDER: 'live',
      STRIPE_WEBHOOK_SECRET: 'whsec_xyz',
    });
    createBillingCheckoutSession.mockRejectedValueOnce(new Error('stripe down'));
    (sql as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([fakePlan])
      .mockResolvedValueOnce([fakeMembership])
      .mockResolvedValueOnce([{ stripe_customer_id: null }]);

    const req = makeRequest({ planId: 'pro' });
    const res = await subscribePost(req);
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json.error).toBe('Failed to start checkout');
  });

  it('falls back to direct activation in dev/test when the secret key is missing', async () => {
    setEnv({
      NODE_ENV: 'test',
      STRIPE_PROVIDER: 'live',
      // STRIPE_SECRET_KEY intentionally absent
    });
    (sql as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([fakePlan])
      .mockResolvedValueOnce([fakeMembership])
      .mockResolvedValueOnce([{ rowCount: 1 }]);

    const req = makeRequest({ planId: 'pro' });
    const res = await subscribePost(req);
    const json = await res.json();

    // Dev/test keeps the flow workable offline; production gets the 503 above.
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.plan).toBe('pro');
    expect(json.trial).toBe(true);
    expect(json.checkoutUrl).toBeUndefined();
    expect(createBillingCheckoutSession).not.toHaveBeenCalled();
  });
});
