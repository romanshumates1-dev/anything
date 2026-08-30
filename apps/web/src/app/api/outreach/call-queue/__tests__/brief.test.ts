import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql, mockCallAI } = vi.hoisted(() => ({
  mockSql: vi.fn(async () => []),
  mockCallAI: vi.fn(async () => ({ text: '• Bullet 1\n• Bullet 2\n• Bullet 3' })),
}));
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));
vi.mock('@/app/api/utils/ai-provider', () => ({ callAI: mockCallAI }));

import { generateCallBrief } from '../brief';

beforeEach(() => {
  vi.clearAllMocks();
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
});
