import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ValuationAgent } from '../valuation';
import sql from '@/app/api/utils/sql';

vi.mock('@/app/api/utils/sql');

// Create a mock for Anthropic that we can control per test
const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        create: (...args: any[]) => mockCreate(...args)
      }
    }))
  };
});

describe('ValuationAgent', () => {
  let agent: ValuationAgent;

  beforeEach(() => {
    agent = new ValuationAgent();
    vi.clearAllMocks();

    // Default mock response
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            arv: 250000,
            arvConfidence: 0.85,
            repairs: 30000,
            offerMin: 140000,
            offerMax: 160000,
            compsCount: 5
          })
        }
      ]
    });
  });

  it('should value property with good comps', async () => {
    vi.mocked(sql).mockResolvedValueOnce([
      {
        id: 123,
        metadata: {
          beds: 3,
          baths: 2,
          sqft: 1500,
          condition: 'fair'
        }
      }
    ] as any);

    vi.mocked(sql).mockResolvedValueOnce([] as any);

    const result = await agent.execute({ leadId: 123 });

    expect(result.result.arv).toBeGreaterThan(0);
    expect(result.result.arvConfidence).toBeGreaterThan(0);
    expect(result.result.repairs).toBeGreaterThan(0);
    expect(result.result.offerMax).toBeLessThan(result.result.arv);
    expect(result.result.offerMin).toBeLessThan(result.result.offerMax);
  });

  it('should return low confidence with few comps', async () => {
    // Mock Anthropic to return low confidence for this specific test
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            arv: 200000,
            arvConfidence: 0.5,
            repairs: 40000,
            offerMin: 100000,
            offerMax: 120000,
            compsCount: 2
          })
        }
      ]
    });

    vi.mocked(sql).mockResolvedValueOnce([
      {
        id: 124,
        metadata: {
          beds: 3,
          baths: 2,
          sqft: 1500,
          condition: 'poor'
        }
      }
    ] as any);

    vi.mocked(sql).mockResolvedValueOnce([] as any);

    const result = await agent.execute({ leadId: 124 });

    expect(result.confidence).toBeLessThan(0.7);
  });

  it('should persist valuation to database', async () => {
    vi.mocked(sql).mockResolvedValueOnce([
      {
        id: 125,
        metadata: { beds: 3, baths: 2, sqft: 1500, condition: 'good' }
      }
    ] as any);

    vi.mocked(sql).mockResolvedValueOnce([] as any);

    await agent.execute({ leadId: 125 });

    // Check that INSERT was called - sql is called with tagged template
    const calls = vi.mocked(sql).mock.calls;
    const insertCall = calls.find(call =>
      call[0] && Array.isArray(call[0]) && call[0][0]?.includes('INSERT INTO property_valuations')
    );
    expect(insertCall).toBeDefined();
  });
});
