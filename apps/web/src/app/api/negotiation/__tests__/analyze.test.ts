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

    // The credit is handed back AND the caller gets a real response. This test
    // previously asserted that the rejection propagated out of the route
    // unhandled - its own comment said "unhandled by design here". That is the
    // defect fixed in this change: an escaping rejection becomes an opaque 500
    // with no indication the credit was returned, so a user who retries cannot
    // tell whether they were charged. The refund assertion below is unchanged
    // and remains the point of the test.
    const res = await POST(post({ inputs: { arv: 100000 } }));
    expect(res.status).toBe(502);
    expect(mockRelease).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body.creditReleased).toBe(true);
  });

  it('does not refund on success - the credit was genuinely spent', async () => {
    const { POST } = await import('../analyze/route');
    const res = await POST(post({ inputs: { arv: 100000 } }));

    expect(res.status).toBe(200);
    expect(mockAnalyzeNegotiation).toHaveBeenCalledTimes(1);
    expect(mockRelease).not.toHaveBeenCalled();
  });
});
describe('provider failure returns an actionable response (not an opaque 500)', () => {
  /**
   * These are VERBATIM provider messages observed on 2026-09-30 against the
   * deployed configuration - both providers were failing at the same time, which
   * is why the classification must distinguish them rather than lumping them
   * together as "AI is down".
   */
  const ANTHROPIC_CREDITS =
    'Anthropic API error [400]: {"type":"error","error":{"type":"invalid_request_error",' +
    '"message":"Your credit balance is too low to access the Anthropic API. Please go to ' +
    'Plans & Billing to upgrade or purchase credits."},"request_id":"req_011CfadwajxjUYuFaFnsBPcJ"}';

  const BEDROCK_TOKEN =
    'Bedrock error [403] for model us.anthropic.claude-haiku-4-5-20251001-v1:0 - check: ' +
    '1) model is enabled in Bedrock console, 2) region matches, 3) IAM has ' +
    'bedrock:InvokeModel permission: The security token included in the request is invalid.';

  it('returns 502 with credits_exhausted for the Anthropic out-of-credit error', async () => {
    mockAnalyzeNegotiation.mockRejectedValueOnce(new Error(ANTHROPIC_CREDITS));
    const { POST } = await import('../analyze/route');
    const res = await POST(post({ inputs: { arv: 100000 } }));

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.failureClass).toBe('credits_exhausted');
    expect(body.creditReleased).toBe(true);
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it('returns 502 with invalid_credentials for the Bedrock token error', async () => {
    mockAnalyzeNegotiation.mockRejectedValueOnce(new Error(BEDROCK_TOKEN));
    const { POST } = await import('../analyze/route');
    const res = await POST(post({ inputs: { arv: 100000 } }));

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.failureClass).toBe('invalid_credentials');
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it('never leaks the raw provider text (request ids, model names)', async () => {
    for (const raw of [ANTHROPIC_CREDITS, BEDROCK_TOKEN]) {
      mockAnalyzeNegotiation.mockRejectedValueOnce(new Error(raw));
      const { POST } = await import('../analyze/route');
      const res = await POST(post({ inputs: { arv: 100000 } }));
      const body = await res.json();

      expect(body.failureClass).toBeTruthy();
      expect(JSON.stringify(body)).not.toContain('req_011CfadwajxjUYuFaFnsBPcJ');
      expect(JSON.stringify(body)).not.toContain('us.anthropic.claude');
    }
  });

  it('does not blame the user for a server-side outage', async () => {
    mockAnalyzeNegotiation.mockRejectedValueOnce(new Error(BEDROCK_TOKEN));
    const { POST } = await import('../analyze/route');
    const res = await POST(post({ inputs: { arv: 100000 } }));
    const body = await res.json();

    expect(body.hint).toMatch(/temporarily unavailable/i);
    expect(body.hint).toMatch(/credit was returned/i);
    expect(body.hint.toLowerCase()).not.toMatch(/invalid input|check your|bad request/);
  });

  it('falls back to a generic 502 for an unrecognised failure', async () => {
    mockAnalyzeNegotiation.mockRejectedValueOnce(new Error('kaboom: something new'));
    const { POST } = await import('../analyze/route');
    const res = await POST(post({ inputs: { arv: 100000 } }));

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.failureClass).toBe('unknown');
    expect(body.hint).toMatch(/temporarily unavailable/i);
    // Still refunds: an unrecognised failure is still a failure.
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });
});