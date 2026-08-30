import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LeadScoringAgent } from '../lead-scoring';
import sql from '@/app/api/utils/sql';

// Mock Anthropic SDK
const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        create: mockCreate
      }
    }))
  };
});

vi.mock('@/app/api/utils/sql');

describe('LeadScoringAgent', () => {
  let agent: LeadScoringAgent;

  beforeEach(() => {
    agent = new LeadScoringAgent();
    vi.clearAllMocks();
  });

  it('should score lead with high distress signals', async () => {
    // Mock lead fetch
    vi.mocked(sql).mockResolvedValueOnce([
      {
        id: 123,
        metadata: {
          signals: ['pre_foreclosure', 'vacant'],
          estimated_arv: 250000,
          estimated_debt: 175000,
          zip: '40202'
        },
        created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) // 3 days ago
      }
    ] as any);

    // Mock Claude response
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            compositeScore: 0.75,
            components: {
              distress: 0.6,
              recency: 0.9,
              equity: 0.7,
              geo: 0.5
            }
          })
        }
      ]
    });

    // Mock insert
    vi.mocked(sql).mockResolvedValueOnce([] as any);

    const result = await agent.execute({ leadId: 123 });

    expect(result.result.compositeScore).toBeGreaterThan(0.6);
    expect(result.result.components.distress).toBeGreaterThan(0.5);
    // Confidence with 4 non-neutral components: 0.5 + 4 * 0.1 = 0.9
    // With the mock response having 4 clearly non-neutral components, expect >= 0.7
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('should handle missing data gracefully', async () => {
    vi.mocked(sql).mockResolvedValueOnce([
      {
        id: 124,
        metadata: {},
        created_at: new Date()
      }
    ] as any);

    // Mock Claude response with low scores for missing data
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            compositeScore: 0.45,
            components: {
              distress: 0.0,
              recency: 0.5,
              equity: 0.5,
              geo: 0.5
            }
          })
        }
      ]
    });

    vi.mocked(sql).mockResolvedValueOnce([] as any);

    const result = await agent.execute({ leadId: 124 });

    expect(result.result.compositeScore).toBeLessThan(0.6);
    expect(result.confidence).toBeLessThan(0.8);
  });

  it('should persist score to database', async () => {
    vi.mocked(sql).mockResolvedValueOnce([
      {
        id: 125,
        metadata: { signals: ['probate'] },
        created_at: new Date()
      }
    ] as any);

    // Mock Claude response
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            compositeScore: 0.55,
            components: {
              distress: 0.25,
              recency: 0.5,
              equity: 0.5,
              geo: 0.5
            }
          })
        }
      ]
    });

    vi.mocked(sql).mockResolvedValueOnce([] as any);

    await agent.execute({ leadId: 125 });

    // Check that sql was called twice: once for SELECT, once for INSERT
    expect(sql).toHaveBeenCalledTimes(2);

    // Check the second call (INSERT) - sql is a tagged template, so first arg is array of strings
    const insertCall = vi.mocked(sql).mock.calls[1];
    const queryString = insertCall[0].join('');
    expect(queryString).toContain('INSERT INTO lead_scores');
  });
});
