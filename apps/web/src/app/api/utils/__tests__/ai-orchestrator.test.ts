import { describe, it, expect, vi } from 'vitest';
import { orchestrateAIResponse, detectHighRisk } from '../ai-orchestrator';

// Mock the global fetch
global.fetch = vi.fn();

describe('AI Orchestrator', () => {
  it('should flag for human escalation when confidence is low', async () => {
    const mockResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              response_text: "I'm not sure how to answer that.",
              confidence_score: 0.4,
              requires_human: true,
              suggested_action: 'escalate',
              internal_reasoning: 'Query too complex',
            }),
          },
        },
      ],
    };

    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await orchestrateAIResponse(1, [{ role: 'user', content: 'Complex question' }]);

    expect(result.requires_human).toBe(true);
    expect(result.confidence_score).toBeLessThan(0.8);
  });

  it('should handle high confidence responses', async () => {
    const mockResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              response_text: 'Hello! How can I help you sell your house?',
              confidence_score: 0.95,
              requires_human: false,
              suggested_action: 'greet',
              internal_reasoning: 'Standard greeting',
            }),
          },
        },
      ],
    };

    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await orchestrateAIResponse(1, [{ role: 'user', content: 'Hi' }]);

    expect(result.requires_human).toBe(false);
    expect(result.confidence_score).toBe(0.95);
  });
});

describe('detectHighRisk', () => {
  it('flags offers, contracts, pricing and assignments', () => {
    expect(detectHighRisk('Can you send me an offer?')).toBe(true);
    expect(detectHighRisk('Here is the contract to sign')).toBe(true);
    expect(detectHighRisk('We can assign the deal')).toBe(true);
    expect(detectHighRisk('The price is $250,000')).toBe(true);
    expect(detectHighRisk('I can do 5% over asking')).toBe(true);
  });

  it('does not flag ordinary chit-chat', () => {
    expect(detectHighRisk('Hi, how are you today?')).toBe(false);
    expect(detectHighRisk('')).toBe(false);
    expect(detectHighRisk(undefined as any)).toBe(false);
  });
});

describe('AI Orchestrator hardening', () => {
  it('clamps out-of-range confidence and forces escalation', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                response_text: 'ok',
                confidence_score: 5,
                requires_human: false,
                suggested_action: 'reply',
                internal_reasoning: 'x',
              }),
            },
          },
        ],
      }),
    });

    const result = await orchestrateAIResponse(1, [{ role: 'user', content: 'Hi' }]);
    expect(result.confidence_score).toBe(1);
  });

  it('throws on malformed (non-JSON) model output', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'not json' } }] }),
    });

    await expect(orchestrateAIResponse(1, [{ role: 'user', content: 'Hi' }])).rejects.toThrow();
  });

  it('throws when the API responds with a non-ok status', async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      json: async () => ({}),
    });

    await expect(orchestrateAIResponse(1, [{ role: 'user', content: 'Hi' }])).rejects.toThrow();
  });
});
