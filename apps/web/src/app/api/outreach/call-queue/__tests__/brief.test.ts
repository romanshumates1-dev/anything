import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql, mockCallAI, mockAuthorizeAiRequest } = vi.hoisted(() => ({
  mockSql: vi.fn(async () => []),
  mockCallAI: vi.fn(async () => ({ text: '• Bullet 1\n• Bullet 2\n• Bullet 3' })),
  // The Phase 11 credit gate. Default: an included credit is authorized, so
  // the pre-existing generation/caching behavior is unchanged; the denial case
  // below overrides it.
  mockAuthorizeAiRequest: vi.fn(async () => ({
    ok: true,
    bucket: 'included',
    caps: { monthly: 50, weekly: 12, daily: 2 },
    keys: {},
    release: vi.fn(async () => {}),
  })),
}));
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));
vi.mock('@/app/api/utils/ai-provider', () => ({ callAI: mockCallAI }));
vi.mock('@/app/api/utils/aiCreditGate', () => ({
  authorizeAiRequest: mockAuthorizeAiRequest,
}));

import { generateCallBrief } from '../brief';

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthorizeAiRequest.mockResolvedValue({
    ok: true,
    bucket: 'included',
    caps: { monthly: 50, weekly: 12, daily: 2 },
    keys: {},
    release: vi.fn(async () => {}),
  });
});

describe('generateCallBrief', () => {
  it('returns cached brief when fresh (< 24h old)', async () => {
    const recentTime = new Date(Date.now() - 3600_000).toISOString();
    mockSql.mockResolvedValueOnce([{
      id: 1,
      name: 'John',
      phone: '+15025550101',
      email: null,
      status: 'new',
      metadata: { call_brief: { text: 'cached brief', generated_at: recentTime } },
      recent_messages: null,
    }]);

    const result = await generateCallBrief(1, 'org_1');
    expect(result.brief).toBe('cached brief');
    expect(result.stale).toBe(false);
    expect(mockCallAI).not.toHaveBeenCalled();
  });

  it('regenerates when cached brief is stale (> 24h)', async () => {
    const staleTime = new Date(Date.now() - 25 * 3600_000).toISOString();
    mockSql
      .mockResolvedValueOnce([{
        id: 1,
        name: 'John',
        phone: '+15025550101',
        email: 'john@test.com',
        status: 'new',
        metadata: {
          call_brief: { text: 'old brief', generated_at: staleTime },
          property_address: '123 Main St',
          signals: ['probate'],
        },
        recent_messages: null,
      }])
      .mockResolvedValueOnce([]); // UPDATE statement

    const result = await generateCallBrief(1, 'org_1');
    expect(result.brief).toBe('• Bullet 1\n• Bullet 2\n• Bullet 3');
    expect(mockCallAI).toHaveBeenCalledTimes(1);
    const aiCall = mockCallAI.mock.calls[0][0];
    expect(aiCall.messages[0].content).toContain('123 Main St');
    expect(aiCall.messages[0].content).toContain('probate');
  });

  it('generates fresh brief when no cache exists', async () => {
    mockSql
      .mockResolvedValueOnce([{
        id: 2,
        name: 'Jane',
        phone: '+15025550102',
        email: null,
        status: 'contacted',
        metadata: { signals: ['vacant', 'tax_lien'], equity: '$45,000' },
        recent_messages: [{ role: 'user', content: 'I might sell' }],
      }])
      .mockResolvedValueOnce([]); // UPDATE

    const result = await generateCallBrief(2, 'org_1');
    expect(result.brief).toContain('Bullet');
    expect(mockCallAI).toHaveBeenCalledTimes(1);
    const prompt = mockCallAI.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain('vacant');
    expect(prompt).toContain('$45,000');
  });

  it('throws when lead not found', async () => {
    mockSql.mockResolvedValueOnce([]);
    await expect(generateCallBrief(999, 'org_1')).rejects.toThrow('Lead 999 not found');
  });

  it('caches the generated brief in leads.metadata', async () => {
    mockSql
      .mockResolvedValueOnce([{
        id: 3,
        name: 'Bob',
        phone: '+15025550103',
        email: null,
        status: 'new',
        metadata: {},
        recent_messages: null,
      }])
      .mockResolvedValueOnce([]); // UPDATE

    await generateCallBrief(3, 'org_1');
    expect(mockSql).toHaveBeenCalledTimes(2);
    const updateCall = mockSql.mock.calls[1][0].join('');
    expect(updateCall).toContain('call_brief');
    expect(updateCall).toContain('jsonb_set');
  });

  // ── Phase 11 credit gate ──────────────────────────────────────────────
  it('does not call the provider when the credit gate denies', async () => {
    mockAuthorizeAiRequest.mockResolvedValue({
      ok: false,
      reason: 'no_credits',
      message: 'You are out of AI credits.',
      caps: { monthly: 0, weekly: 0, daily: 0 },
      keys: {},
    });
    mockSql.mockResolvedValueOnce([{
      id: 4,
      name: 'Dana',
      phone: '+15025550104',
      email: null,
      status: 'new',
      metadata: {},
      recent_messages: null,
    }]);

    await expect(generateCallBrief(4, 'org_1')).rejects.toThrow('out of AI credits');
    // Nothing was authorized, so nothing may reach the provider.
    expect(mockCallAI).not.toHaveBeenCalled();
  });

  it('does not charge a credit for a cached brief', async () => {
    const recentTime = new Date(Date.now() - 60_000).toISOString();
    mockSql.mockResolvedValueOnce([{
      id: 5,
      name: 'Eve',
      phone: '+15025550105',
      email: null,
      status: 'new',
      metadata: { call_brief: { text: 'cached', generated_at: recentTime } },
      recent_messages: null,
    }]);

    const result = await generateCallBrief(5, 'org_1');
    expect(result.brief).toBe('cached');
    expect(mockAuthorizeAiRequest).not.toHaveBeenCalled();
  });

  it('releases the credit when the provider call fails', async () => {
    const release = vi.fn(async () => {});
    mockAuthorizeAiRequest.mockResolvedValue({
      ok: true,
      bucket: 'included',
      caps: { monthly: 50, weekly: 12, daily: 2 },
      keys: {},
      release,
    });
    mockCallAI.mockRejectedValueOnce(new Error('provider down'));
    mockSql.mockResolvedValueOnce([{
      id: 6,
      name: 'Frank',
      phone: '+15025550106',
      email: null,
      status: 'new',
      metadata: {},
      recent_messages: null,
    }]);

    await expect(generateCallBrief(6, 'org_1')).rejects.toThrow('provider down');
    // A failed generation must not silently burn the customer's credit.
    expect(release).toHaveBeenCalledTimes(1);
  });
});