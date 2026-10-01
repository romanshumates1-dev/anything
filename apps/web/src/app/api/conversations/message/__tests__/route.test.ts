/**
 * Regression tests for the 2026-09-30 repair of POST /api/conversations/message.
 *
 * Fixes pinned here:
 *   1. Provider outages returned an opaque 500 (the rethrown error fell into
 *      the outer catch). Now: 502 via the shared responder, classified, with
 *      the AI credit released and no raw provider text leaked.
 *   2. A malformed JSON body returned 500 (request.json() threw inside the
 *      main try). Now: 400.
 *   3. Oversized declared bodies are rejected with 413 before parsing.
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

const { orchestrateAIResponse, detectHighRisk } = vi.hoisted(() => ({
  orchestrateAIResponse: vi.fn(),
  detectHighRisk: vi.fn(() => false),
}));
vi.mock('@/app/api/utils/ai-orchestrator', () => ({
  orchestrateAIResponse: (...a: any[]) => orchestrateAIResponse(...a),
  detectHighRisk: (...a: any[]) => detectHighRisk(...a),
}));

const { checkConsent } = vi.hoisted(() => ({ checkConsent: vi.fn() }));
vi.mock('@/app/api/utils/compliance', () => ({
  checkConsent: (...a: any[]) => checkConsent(...a),
}));

const { enqueueJob } = vi.hoisted(() => ({ enqueueJob: vi.fn() }));
vi.mock('@/app/api/utils/jobs', () => ({ enqueueJob: (...a: any[]) => enqueueJob(...a) }));

const { logEvent } = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/app/api/utils/logger', () => ({ logEvent: (...a: any[]) => logEvent(...a) }));

const { authorizeAiRequest } = vi.hoisted(() => ({ authorizeAiRequest: vi.fn() }));
vi.mock('@/app/api/utils/aiCreditGate', () => ({
  authorizeAiRequest: (...a: any[]) => authorizeAiRequest(...a),
}));

const mockRelease = vi.fn();

function allowCredits() {
  authorizeAiRequest.mockResolvedValue({
    ok: true,
    bucket: 'included',
    release: mockRelease,
  });
}

function post(body: unknown, init?: { headers?: Record<string, string> }) {
  return {
    json: () => Promise.resolve(body),
    headers: new Headers(init?.headers ?? {}),
  } as unknown as Request;
}

const VALID_BODY = { leadId: 42, message: 'Is the property still available?', channel: 'sms' };

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: 'user-1' } });
  getOrganization.mockResolvedValue({ id: 'org-A' });
  checkConsent.mockResolvedValue(true);
  mockRelease.mockResolvedValue(undefined);
  mockSql.mockImplementation(async (...args: any[]) => {
    // Route makes these calls in order: lead lookup, get-or-create conv,
    // append history, persist AI draft. Give each a plausible row.
    const first = args[0]?.[0] ?? '';
    if (typeof first === 'string' && first.includes('SELECT * FROM leads')) {
      return [{ id: 42, phone: '+15551234567', organization_id: 'org-A' }];
    }
    return [{ id: 7, history: [], organization_id: 'org-A' }];
  });
  orchestrateAIResponse.mockResolvedValue({
    response_text: 'Yes â€” would you like to schedule a walkthrough?',
    confidence_score: 0.9,
    requires_human: false,
  });
  allowCredits();
});

describe('POST /api/conversations/message â€” request hygiene', () => {
  it('returns 400 (not 500) for a malformed JSON body, charging nothing', async () => {
    const { POST } = await import('../route');
    const broken = {
      json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')),
      headers: new Headers(),
    } as unknown as Request;
    const res = await POST(broken);
    expect(res.status).toBe(400);
    expect(authorizeAiRequest).not.toHaveBeenCalled();
    expect(orchestrateAIResponse).not.toHaveBeenCalled();
  });

  it('returns 413 for an oversized DECLARED body before parsing it', async () => {
    const { POST } = await import('../route');
    let parsed = false;
    const huge = {
      json: () => {
        parsed = true;
        return Promise.resolve(VALID_BODY);
      },
      headers: new Headers({ 'content-length': String(10 * 1024 * 1024) }),
    } as unknown as Request;
    const res = await POST(huge);
    expect(res.status).toBe(413);
    expect(parsed).toBe(false); // rejected on the header, never parsed
    expect(authorizeAiRequest).not.toHaveBeenCalled();
  });

  it('returns 413 when the message itself exceeds 4000 chars, charging nothing', async () => {
    const { POST } = await import('../route');
    const res = await POST(post({ ...VALID_BODY, message: 'x'.repeat(4001) }));
    expect(res.status).toBe(413);
    expect(authorizeAiRequest).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-numeric leadId before any credit work', async () => {
    // leads.id is `serial`, so a value like 'lead_mine' can never be a real lead.
    // The old code passed it straight into the lookup; Postgres would answer
    // with an opaque 500 (invalid integer input) for what is really a bad request.
    const { POST } = await import('../route');
    const res = await POST(post({ ...VALID_BODY, leadId: 'lead_mine' }));
    expect(res.status).toBe(400);
    expect(authorizeAiRequest).not.toHaveBeenCalled();
    expect(orchestrateAIResponse).not.toHaveBeenCalled();
  });


  it('401s anonymous callers', async () => {
    getSession.mockResolvedValueOnce(null);
    const { POST } = await import('../route');
    const res = await POST(post(VALID_BODY));
    expect(res.status).toBe(401);
  });

  it('404s a lead outside the caller org (IDOR guard)', async () => {
    mockSql.mockResolvedValueOnce([]); // lead lookup scoped by org misses
    const { POST } = await import('../route');
    const res = await POST(post(VALID_BODY));
    expect(res.status).toBe(404);
    expect(orchestrateAIResponse).not.toHaveBeenCalled();
  });

  it('403s opted-out contacts without charging a credit', async () => {
    checkConsent.mockResolvedValueOnce(false);
    const { POST } = await import('../route');
    const res = await POST(post(VALID_BODY));
    expect(res.status).toBe(403);
    expect(authorizeAiRequest).not.toHaveBeenCalled();
  });

describe('POST /api/conversations/message â€” provider failure path (502, not 500)', () => {
  it('returns 502 with a classified failure and the credit released', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    orchestrateAIResponse.mockRejectedValueOnce(
      new Error(
        'Anthropic API error [400]: {"message":"Your credit balance is too low to access the Anthropic API.","request_id":"req_CONV789"}'
      )
    );
    const { POST } = await import('../route');
    const res = await POST(post(VALID_BODY));

    expect(res.status).toBe(502); // NOT the old opaque 500
    const body = await res.json();
    expect(body.failureClass).toBe('credits_exhausted');
    expect(body.creditReleased).toBe(true);
    expect(mockRelease).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(body)).not.toContain('req_CONV789');
    // Nothing outbound is queued when orchestration fails.
    expect(enqueueJob).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('returns 502 for a Bedrock credential failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    orchestrateAIResponse.mockRejectedValueOnce(
      new Error('Bedrock error [403]: The security token included in the request is invalid.')
    );
    const { POST } = await import('../route');
    const res = await POST(post(VALID_BODY));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.failureClass).toBe('invalid_credentials');
    expect(mockRelease).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it('reports creditReleased=false when release fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRelease.mockRejectedValueOnce(new Error('ledger down'));
    orchestrateAIResponse.mockRejectedValueOnce(new Error('kaboom'));
    const { POST } = await import('../route');
    const res = await POST(post(VALID_BODY));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.creditReleased).toBe(false);
    vi.restoreAllMocks();
  });
});

describe('POST /api/conversations/message â€” happy path', () => {
  it('returns the AI draft end-to-end (mocked) with 200', async () => {
    const { POST } = await import('../route');
    const res = await POST(post(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.response).toContain('walkthrough');
    expect(body.requiresHuman).toBe(false);
    expect(orchestrateAIResponse).toHaveBeenCalledTimes(1);
    expect(enqueueJob).toHaveBeenCalledTimes(1); // auto-send allowed
  });

  it('honours the credit gate denial with 402 and makes NO provider call', async () => {
    authorizeAiRequest.mockResolvedValueOnce({
      ok: false,
      reason: 'no_credits',
      message: 'You have used all your AI credits for this period.',
      code: 'INSUFFICIENT_CREDITS',
    });
    const { POST } = await import('../route');
    const res = await POST(post(VALID_BODY));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.code).toBe('INSUFFICIENT_CREDITS');
    expect(orchestrateAIResponse).not.toHaveBeenCalled();
  });

  it('forces human review for risky content regardless of the model flag', async () => {
    orchestrateAIResponse.mockResolvedValueOnce({
      response_text: 'I can sign that purchase agreement for you.',
      confidence_score: 0.95,
      requires_human: false, // model says fine â€” server must disagree
    });
    detectHighRisk.mockReturnValueOnce(true);
    const { POST } = await import('../route');
    const res = await POST(post(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requiresHuman).toBe(true);
    expect(enqueueJob).not.toHaveBeenCalled(); // never auto-send offers
  });
});

describe('POST /api/conversations/message — post-gate failures also hand the credit back', () => {
  it('releases the credit when a step AFTER the provider call fails', async () => {
    // The provider succeeded, so the inner handler does not run — but the
    // request still produced no draft the customer can use (the queue write
    // failed). Returning 500 here without releasing would charge for nothing.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    enqueueJob.mockRejectedValueOnce(new Error('queue down'));
    const { POST } = await import('../route');
    const res = await POST(post(VALID_BODY));
    expect(res.status).toBe(500);
    expect(mockRelease).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});


});
