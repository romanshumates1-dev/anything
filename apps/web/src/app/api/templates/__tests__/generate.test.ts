/**
 * Regression tests for the 2026-09-30 repair of POST /api/templates/generate.
 *
 * Two defects were fixed and both are pinned here:
 *   1. VALIDATION BEFORE THE GATE — an over-long/invalid prompt used to reach
 *      `authorizeAiRequest` first, burn a credit, then 400 without refunding
 *      it. Every invalid input must now be rejected with ZERO gate calls.
 *   2. PROVIDER OUTAGES => 502 (not opaque 500) via the shared responder,
 *      with the credit returned and no raw provider text leaked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { default: mockSql } = vi.hoisted(() => {
  const m: any = vi.fn(async () => []);
  return { default: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: (...a: any[]) => getSession(...a) } },
}));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));

const { getOrganization } = vi.hoisted(() => ({ getOrganization: vi.fn() }));
vi.mock('@/lib/organization-context', () => ({
  getOrganization: (...a: any[]) => getOrganization(...a),
}));

const { callAI } = vi.hoisted(() => ({ callAI: vi.fn() }));
vi.mock('@/app/api/utils/ai-provider', () => ({ callAI: (...a: any[]) => callAI(...a) }));

const { authorizeAiRequest } = vi.hoisted(() => ({ authorizeAiRequest: vi.fn() }));
vi.mock('@/app/api/utils/aiCreditGate', () => ({
  authorizeAiRequest: (...a: any[]) => authorizeAiRequest(...a),
}));

const { checkRateLimit } = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));
vi.mock('@/app/api/services/rateLimiter', () => ({
  checkRateLimit: (...a: any[]) => checkRateLimit(...a),
}));

const mockRelease = vi.fn();

function allowCredits() {
  authorizeAiRequest.mockResolvedValue({
    ok: true,
    bucket: 'included',
    release: mockRelease,
  });
}

function denyCredits() {
  authorizeAiRequest.mockResolvedValue({
    ok: false,
    reason: 'no_credits',
    message: 'You have used all your AI credits for this period.',
    code: 'INSUFFICIENT_CREDITS',
  });
}

/** A request double carrying a JSON body (and optional headers). */
function post(body: unknown, init?: { headers?: Record<string, string> }) {
  return {
    json: () => Promise.resolve(body),
    headers: new Headers(init?.headers ?? {}),
  } as unknown as Request;
}

const VALID_BODY = {
  prompt: 'A friendly first-contact SMS for vacant land owners in Jefferson County',
  tone: 'friendly' as const,
  channel: 'sms' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: 'user-1' } });
  getOrganization.mockResolvedValue({ id: 'org_1' });
  checkRateLimit.mockResolvedValue({ allowed: true });
  mockRelease.mockResolvedValue(undefined);
  mockSql.mockResolvedValue([{ id: 1 }]); // INSERT template ... RETURNING
  callAI.mockResolvedValue({
    text: JSON.stringify({
      body: 'Hi {{firstName}}, is the property at {{propertyAddress}} still available?',
      followUps: [],
      variables: ['{{firstName}}', '{{propertyAddress}}'],
    }),
    model: 'test-model',
    usage: { input_tokens: 10, output_tokens: 20 },
  });
  allowCredits();
});

describe('POST /api/templates/generate — validation before the credit gate', () => {
  it('rejects a too-short prompt with 400 and NEVER calls the credit gate', async () => {
    const { POST } = await import('../generate/route');
    const res = await POST(post({ ...VALID_BODY, prompt: 'short' }));
    expect(res.status).toBe(400);
    expect(authorizeAiRequest).not.toHaveBeenCalled();
    expect(callAI).not.toHaveBeenCalled();
  });

  it('rejects an over-long prompt with 400, zero credits charged', async () => {
    const { POST } = await import('../generate/route');
    const res = await POST(post({ ...VALID_BODY, prompt: 'x'.repeat(2001) }));
    expect(res.status).toBe(400);
    expect(authorizeAiRequest).not.toHaveBeenCalled();
    expect(callAI).not.toHaveBeenCalled();
  });

  it('rejects an unsupported channel with 400 (strict enum), zero credits', async () => {
    const { POST } = await import('../generate/route');
    const res = await POST(post({ ...VALID_BODY, channel: 'carrier-pigeon' }));
    expect(res.status).toBe(400);
    expect(authorizeAiRequest).not.toHaveBeenCalled();
  });

  it('rejects an unsupported tone with 400, zero credits', async () => {
    const { POST } = await import('../generate/route');
    const res = await POST(post({ ...VALID_BODY, tone: 'sarcastic' }));
    expect(res.status).toBe(400);
    expect(authorizeAiRequest).not.toHaveBeenCalled();
  });

  it('rejects a malformed JSON body with 400, zero credits', async () => {
    const { POST } = await import('../generate/route');
    const broken = {
      json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')),
      headers: new Headers(),
    } as unknown as Request;
    const res = await POST(broken);
    expect(res.status).toBe(400);
    expect(authorizeAiRequest).not.toHaveBeenCalled();
    expect(callAI).not.toHaveBeenCalled();
  });

  it('honours the credit gate denial with 402 and makes NO provider call', async () => {
    denyCredits();
    const { POST } = await import('../generate/route');
    const res = await POST(post(VALID_BODY));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.code).toBe('INSUFFICIENT_CREDITS');
    expect(callAI).not.toHaveBeenCalled();
  });
});


describe('POST /api/templates/generate — provider failure path', () => {
  it('returns 502 with a classified failure and the credit released', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    callAI.mockRejectedValueOnce(
      new Error(
        'Anthropic API error [400]: {"message":"Your credit balance is too low to access the Anthropic API.","request_id":"req_TEST123"}'
      )
    );
    const { POST } = await import('../generate/route');
    const res = await POST(post(VALID_BODY));

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.failureClass).toBe('credits_exhausted');
    expect(body.creditReleased).toBe(true);
    expect(mockRelease).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(body)).not.toContain('req_TEST123');
    vi.restoreAllMocks();
  });

  it('returns 502 (not 500) for a credential failure too', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    callAI.mockRejectedValueOnce(
      new Error('Bedrock error [403]: The security token included in the request is invalid.')
    );
    const { POST } = await import('../generate/route');
    const res = await POST(post(VALID_BODY));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.failureClass).toBe('invalid_credentials');
    expect(mockRelease).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it('reports creditReleased=false when the release itself fails (no lying)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRelease.mockRejectedValueOnce(new Error('ledger down'));
    callAI.mockRejectedValueOnce(new Error('kaboom'));
    const { POST } = await import('../generate/route');
    const res = await POST(post(VALID_BODY));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.creditReleased).toBe(false);
    expect(body.hint).toMatch(/could not be returned/i);
    vi.restoreAllMocks();
  });

  it('rate-limits before anything else with 429', async () => {
    checkRateLimit.mockResolvedValueOnce({
      allowed: false,
      message: 'Slow down',
      resetsAt: Date.now() + 1000,
    });
    const { POST } = await import('../generate/route');
    const res = await POST(post(VALID_BODY));
    expect(res.status).toBe(429);
    expect(authorizeAiRequest).not.toHaveBeenCalled();
    expect(callAI).not.toHaveBeenCalled();
  });

  it('401s anonymous callers before any work', async () => {
    getSession.mockResolvedValueOnce(null);
    const { POST } = await import('../generate/route');
    const res = await POST(post(VALID_BODY));
    expect(res.status).toBe(401);
    expect(callAI).not.toHaveBeenCalled();
  });

  it('succeeds end-to-end (mocked) with 200 and persists a template', async () => {
    const { POST } = await import('../generate/route');
    const res = await POST(post(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.body || body.template?.body).toBeTruthy();
    expect(callAI).toHaveBeenCalledTimes(1);
    expect(mockSql).toHaveBeenCalled();
  });
});
