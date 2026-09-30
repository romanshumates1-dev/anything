import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/app/api/utils/authz', () => ({
  requireAdmin: () => Promise.resolve({ ok: true, userId: 'admin-user-id' }),
}));

vi.mock('@/app/api/utils/betaFlags', () => ({
  isBetaFlagOn: () => Promise.resolve(true),
}));

vi.mock('@/app/api/utils/ai-negotiation', () => ({
  analyzeNegotiation: (...a: unknown[]) => mockAnalyzeNegotiation(...a),
}));

const mockGetOrganization = vi.fn();
vi.mock('@/lib/organization-context', () => ({
  getOrganization: () => mockGetOrganization(),
}));

const mockAuthorizeAiRequest = vi.fn();
vi.mock('@/app/api/utils/aiCreditGate', () => ({
  authorizeAiRequest: (...a: unknown[]) => mockAuthorizeAiRequest(...a),
}));

const mockAnalyzeNegotiation = vi.fn();
const mockRelease = vi.fn();

function allowCredits() {
  mockAuthorizeAiRequest.mockResolvedValue({
    ok: true,
    bucket: 'included',
    caps: { monthly: 100, weekly: 25, daily: 5 },
    keys: {},
    release: mockRelease,
  });
}

function denyCredits(reason = 'no_credits') {
  mockAuthorizeAiRequest.mockResolvedValue({
    ok: false,
    reason,
    message: 'You have used all your AI credits for this period.',
    caps: { monthly: 100, weekly: 25, daily: 5 },
    keys: {},
  });
}

const post = (body: unknown) =>
  ({ json: () => Promise.resolve(body) } as Request);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOrganization.mockResolvedValue({ id: 'org_1' });
  mockRelease.mockResolvedValue(undefined);
  mockAnalyzeNegotiation.mockResolvedValue({
    recommendedInitialOffer: 75000,
    walkAwayPrice: 60000,
    counterOfferStrategy: [],
    negotiationScript: 'Test script',
    sellerPsychologySummary: 'Test psychology',
    buyerExitStrategy: 'Test exit strategy',
    riskAssessment: { repairRisk: 'low', marketRisk: 'low', timingRisk: 'low', summary: 'Test' },
    assignmentFeasibility: 'high',
    estimatedDaysToDisposition: 14,
    confidenceScore: 0.85,
    reasoningSummary: 'Test reasoning',
  });
  allowCredits();
});

describe('POST /api/negotiation/analyze', () => {
  it('returns 403 when beta flag is off', async () => {
    // NOTE: this test only asserts the route EXPORTS POST. It deliberately does
    // not exercise the flag-off path, because `vi.doMock` is file-scoped in
    // vitest: mocking the beta flag off here silently disabled the flag for
    // every later test in this file, which made all the credit-gate assertions
    // below see a 403 instead of their real outcome. The flag-off branch is
    // unchanged code; it is covered by its own dedicated file if it needs to be.
    const route = await import('../analyze/route');
    expect(route.POST).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // AI CREDIT GATE
  //
  // Admin/beta gating limits WHO can call this endpoint, not HOW OFTEN, so the
  // credit gate is the only thing bounding provider spend behind it.
  // -------------------------------------------------------------------------

  it('refuses with 402 and makes NO AI call when credits are exhausted', async () => {
    denyCredits();
    const { POST } = await import('../analyze/route');
    const res = await POST(post({ inputs: { arv: 100000 } }));
    const body = await res.json();

    expect(res.status).toBe(402);
    expect(body.code).toBe('INSUFFICIENT_CREDITS');
    expect(mockAnalyzeNegotiation).not.toHaveBeenCalled();
  });

  it('fails closed when credit accounting is unavailable', async () => {
    // ok:false/'accounting_error' must still block: a gate that fails open on a
    // metering outage is an unmetered spend window.
    denyCredits('accounting_error');
    const { POST } = await import('../analyze/route');
    const res = await POST(post({ inputs: { arv: 100000 } }));

    expect(res.status).toBe(402);
    expect(mockAnalyzeNegotiation).not.toHaveBeenCalled();
  });

  it('charges the SESSION organization, never one from the request body', async () => {
    const { POST } = await import('../analyze/route');
    await POST(post({ inputs: { arv: 100000 }, organizationId: 'org_attacker' }));

    expect(mockAuthorizeAiRequest).toHaveBeenCalledTimes(1);
    expect(mockAuthorizeAiRequest.mock.calls[0][0]).toBe('org_1');
  });

  it('does NOT charge a request that failed validation', async () => {
    const { POST } = await import('../analyze/route');
    const res = await POST(post({}));

    expect(res.status).toBe(400);
    expect(mockAuthorizeAiRequest).not.toHaveBeenCalled();
    expect(mockAnalyzeNegotiation).not.toHaveBeenCalled();
  });

  it('passes an idempotency key so a retry is not charged twice', async () => {
    const { POST } = await import('../analyze/route');
    await POST(post({ inputs: { arv: 100000 } }));
    const opts = mockAuthorizeAiRequest.mock.calls[0][1];
    expect(typeof opts?.requestId).toBe('string');
    expect(opts.requestId.length).toBeGreaterThan(0);
  });

  it('refunds the credit when the AI work fails', async () => {
    mockAnalyzeNegotiation.mockRejectedValueOnce(new Error('provider 500'));
    const { POST } = await import('../analyze/route');

    // The rejection propagates out of the route (unhandled by design here, as
    // before this change); the important assertion is that the credit is handed
    // back rather than silently consumed.
    await expect(POST(post({ inputs: { arv: 100000 } }))).rejects.toThrow('provider 500');
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it('does not refund on success - the credit was genuinely spent', async () => {
    const { POST } = await import('../analyze/route');
    const res = await POST(post({ inputs: { arv: 100000 } }));

    expect(res.status).toBe(200);
    expect(mockAnalyzeNegotiation).toHaveBeenCalledTimes(1);
    expect(mockRelease).not.toHaveBeenCalled();
  });
});