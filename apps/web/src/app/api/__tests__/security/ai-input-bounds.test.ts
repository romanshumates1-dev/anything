import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * AI INPUT BOUNDS (2026-09-26 security sweep).
 *
 * The AI surface was reviewed route by route. Prompt-injection hardening was
 * already present where untrusted third-party text enters a prompt
 * (`ai-sales-prompt.ts` explicitly instructs the model to treat lead messages
 * as untrusted data), provider errors are sanitized, and credit/rate gates sit
 * in front of the calls. What was missing were CEILINGS on caller-supplied
 * input: unbounded text is simultaneously a provider-cost amplifier, a
 * latency/timeout risk, and a storage-growth vector.
 *
 * These tests pin the ceilings so a future edit cannot quietly remove them.
 */

const mockGetSession = vi.fn();
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: () => mockGetSession() } },
}));

const mockGetOrganization = vi.fn();
vi.mock('@/lib/organization-context', () => ({
  getOrganization: () => mockGetOrganization(),
}));

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

const mockCheckRateLimit = vi.fn();
vi.mock('@/app/api/services/rateLimiter', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const mockCallAI = vi.fn();
vi.mock('@/app/api/utils/ai-provider', () => ({
  callAI: (...args: unknown[]) => mockCallAI(...args),
}));

const mockSql = vi.fn();
vi.mock('@/app/api/utils/sql', () => ({
  default: (...args: unknown[]) => mockSql(...args),
}));

// The negotiation endpoint is admin-only; mock the guard so the input-bound
// assertions exercise the bound rather than the authorization wall.
vi.mock('@/app/api/utils/authz', () => ({
  requireAdmin: vi.fn().mockResolvedValue({ ok: true }),
}));

const mockRandomUUID = vi.fn(() => 'gen-uuid-1');
vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('crypto')>();
  return { ...actual, randomUUID: mockRandomUUID };
});

const SESSION = { user: { id: 'user_1' }, session: { userId: 'user_1' } };
const ORG = { id: 'org_1', name: 'Test Org' };

function postJson(url: string, body: unknown, extraHeaders: Record<string, string> = {}) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue(SESSION);
  mockGetOrganization.mockResolvedValue(ORG);
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
});

describe('POST /api/support/chat — input bounds', () => {
  const URL_ = 'http://localhost:4000/api/support/chat';

  it('rejects an over-large declared body before parsing it (413)', async () => {
    const { POST } = await import('../../support/chat/route');
    // Small real body, oversized declared length: proves the check happens
    // before `request.json()` rather than after.
    const res = await POST(
      postJson(URL_, { messages: [{ role: 'user', content: 'hi' }] }, {
        'content-length': String(10 * 1024 * 1024),
      })
    );
    expect(res.status).toBe(413);
    expect(mockCallAI).not.toHaveBeenCalled();
  });

  it('rejects an oversized messages array (400) before mapping it', async () => {
    const { POST } = await import('../../support/chat/route');
    const messages = Array.from({ length: 51 }, () => ({
      role: 'user',
      content: 'x',
    }));
    const res = await POST(postJson(URL_, { messages }));
    expect(res.status).toBe(400);
    expect(mockCallAI).not.toHaveBeenCalled();
  });

  it('still serves a normal conversation, sending only the last 10 turns', async () => {
    const { POST } = await import('../../support/chat/route');
    mockCallAI.mockResolvedValue({ text: 'hello', model: 'test-model' });

    const messages = [
      ...Array.from({ length: 20 }, () => ({ role: 'user', content: 'earlier' })),
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'the real question' },
    ];
    const res = await POST(postJson(URL_, { messages }));
    expect(res.status).toBe(200);

    const call = mockCallAI.mock.calls[0][0];
    expect(call.messages).toHaveLength(10);
    expect(call.messages.at(-1).content).toBe('the real question');
    expect(call.maxTokens).toBe(500);
  });

  it('truncates an individual over-long message to 2000 characters', async () => {
    const { POST } = await import('../../support/chat/route');
    mockCallAI.mockResolvedValue({ text: 'ok', model: 'm' });

    await POST(
      postJson(URL_, {
        messages: [{ role: 'user', content: 'a'.repeat(9000) }],
      })
    );
    const call = mockCallAI.mock.calls[0][0];
    expect(call.messages[0].content).toHaveLength(2000);
  });
});

describe('POST /api/templates/generate — input bounds', () => {
  const URL_ = 'http://localhost:4000/api/templates/generate';

  it('rejects a prompt longer than 2000 characters (400)', async () => {
    const { POST } = await import('../../templates/generate/route');
    const res = await POST(postJson(URL_, { prompt: 'a'.repeat(2001) }));
    expect(res.status).toBe(400);
    expect(mockCallAI).not.toHaveBeenCalled();
  });

  it('rejects an over-long campaign goal (400)', async () => {
    const { POST } = await import('../../templates/generate/route');
    const res = await POST(
      postJson(URL_, {
        prompt: 'a valid description of a campaign',
        campaignGoal: 'g'.repeat(501),
      })
    );
    expect(res.status).toBe(400);
    expect(mockCallAI).not.toHaveBeenCalled();
  });

  it('rejects an over-long target audience (400)', async () => {
    const { POST } = await import('../../templates/generate/route');
    const res = await POST(
      postJson(URL_, {
        prompt: 'a valid description of a campaign',
        targetAudience: 't'.repeat(501),
      })
    );
    expect(res.status).toBe(400);
  });

  it('accepts a normal request and passes bounded text to the model', async () => {
    const { POST } = await import('../../templates/generate/route');
    mockCallAI.mockResolvedValue({
      text: JSON.stringify({ subject: 'S', body: 'B', followUps: [] }),
      model: 'm',
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    mockSql.mockResolvedValue([]);

    const res = await POST(
      postJson(URL_, { prompt: 'write a knock-down SMS', channel: 'sms' })
    );
    expect(res.status).toBe(200);
    const call = mockCallAI.mock.calls[0][0];
    expect(call.messages[0].content).toContain('write a knock-down SMS');
    expect(call.maxTokens).toBe(1500);
  });
});

describe('POST /api/agents/negotiation — input bounds', () => {
  const URL_ = 'http://localhost:4000/api/agents/negotiation';

  it('rejects a sellerReply longer than 4000 characters (400)', async () => {
    const { POST } = await import('../../agents/negotiation/route');
    const res = await POST(
      postJson(URL_, { leadId: 'lead_1', sellerReply: 'r'.repeat(4001) })
    );
    expect(res.status).toBe(400);
    // Rejected before the tenant-ownership lookup, so no data was touched.
    expect(mockSql).not.toHaveBeenCalled();
  });
});

describe('AI bounds are declared, not magic numbers', () => {
  it('each reviewed route names its limit in a constant', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const expectations: Array<[string, string]> = [
      ['src/app/api/support/chat/route.ts', 'MAX_MESSAGES'],
      ['src/app/api/templates/generate/route.ts', 'MAX_PROMPT_CHARS'],
      ['src/app/api/agents/negotiation/route.ts', 'MAX_SELLER_REPLY_CHARS'],
      ['src/app/api/analytics/ai-recommendations/route.ts', 'Math.min(365'],
    ];
    for (const [rel, marker] of expectations) {
      const text = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
      expect(text, rel).toContain(marker);
    }
  });
});

