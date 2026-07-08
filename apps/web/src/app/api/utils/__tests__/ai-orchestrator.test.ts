import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { orchestrateAIResponse, detectHighRisk } from '../ai-orchestrator';

// Mock the global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock the logger
vi.mock('../logger', () => ({
  logEvent: vi.fn(async () => {}),
}));

describe('AI Orchestrator — Anthropic Messages API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_MODEL;
  });

  it('calls the Anthropic Messages API (not /integrations/ or any scaffold URL)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              response_text: 'Hello! How can I help you sell your house?',
              confidence_score: 0.95,
              requires_human: false,
              suggested_action: 'greet',
              internal_reasoning: 'Standard greeting',
            }),
          },
        ],
      }),
    });

    await orchestrateAIResponse(1, [{ role: 'user', content: 'Hi' }]);

    // Assert the URL is Anthropic, not any scaffold/integration URL
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(url).not.toContain('/integrations/');
    expect(url).not.toContain('gemini');
    expect(url).not.toContain('google');

    // Assert correct headers
    expect(options.headers['x-api-key']).toBe('test-anthropic-key');
    expect(options.headers['anthropic-version']).toBe('2023-06-01');
    expect(options.headers['Content-Type']).toBe('application/json');

    // Assert request body structure
    const body = JSON.parse(options.body);
    expect(body.model).toBe('claude-sonnet-4-20250514');
    expect(body.system).toContain('DealFlow AI Supervisor');
    expect(body.messages).toEqual([{ role: 'user', content: 'Hi' }]);
  });

  it('throws when ANTHROPIC_API_KEY is not configured', async () => {
    delete process.env.ANTHROPIC_API_KEY;

    await expect(
      orchestrateAIResponse(1, [{ role: 'user', content: 'Hi' }])
    ).rejects.toThrow('ANTHROPIC_API_KEY is not configured');

    // Fetch should never be called
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('flags for human escalation when confidence is low', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              response_text: "I'm not sure how to answer that.",
              confidence_score: 0.4,
              requires_human: true,
              suggested_action: 'escalate',
              internal_reasoning: 'Query too complex',
            }),
          },
        ],
      }),
    });

    const result = await orchestrateAIResponse(1, [
      { role: 'user', content: 'Complex question' },
    ]);

    expect(result.requires_human).toBe(true);
    expect(result.confidence_score).toBeLessThan(0.8);
  });

  it('handles high confidence responses', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              response_text: 'Hello! How can I help you sell your house?',
              confidence_score: 0.95,
              requires_human: false,
              suggested_action: 'greet',
              internal_reasoning: 'Standard greeting',
            }),
          },
        ],
      }),
    });

    const result = await orchestrateAIResponse(1, [{ role: 'user', content: 'Hi' }]);

    expect(result.requires_human).toBe(false);
    expect(result.confidence_score).toBe(0.95);
  });

  it('clamps out-of-range confidence and forces escalation', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              response_text: 'ok',
              confidence_score: 5,
              requires_human: false,
              suggested_action: 'reply',
              internal_reasoning: 'x',
            }),
          },
        ],
      }),
    });

    const result = await orchestrateAIResponse(1, [{ role: 'user', content: 'Hi' }]);
    expect(result.confidence_score).toBe(1);
  });

  it('throws on malformed (non-JSON) model output', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'not json' }],
      }),
    });

    await expect(
      orchestrateAIResponse(1, [{ role: 'user', content: 'Hi' }])
    ).rejects.toThrow();
  });

  it('throws when the API responds with a non-ok status', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      text: async () => 'Internal error',
      json: async () => ({}),
    });

    await expect(
      orchestrateAIResponse(1, [{ role: 'user', content: 'Hi' }])
    ).rejects.toThrow();
  });

  it('throws when response has no content blocks', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ content: [] }),
    });

    await expect(
      orchestrateAIResponse(1, [{ role: 'user', content: 'Hi' }])
    ).rejects.toThrow('empty response');
  });

  it('strips markdown code fences from model output', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            type: 'text',
            text: '```json\n{"response_text":"hi","confidence_score":0.9,"requires_human":false,"suggested_action":"reply","internal_reasoning":"x"}\n```',
          },
        ],
      }),
    });

    const result = await orchestrateAIResponse(1, [{ role: 'user', content: 'Hi' }]);
    expect(result.response_text).toBe('hi');
  });

  it('uses ANTHROPIC_MODEL env var when set', async () => {
    process.env.ANTHROPIC_MODEL = 'claude-3-opus-20240229';

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              response_text: 'hi',
              confidence_score: 0.9,
              requires_human: false,
              suggested_action: 'reply',
              internal_reasoning: 'x',
            }),
          },
        ],
      }),
    });

    await orchestrateAIResponse(1, [{ role: 'user', content: 'Hi' }]);

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.model).toBe('claude-3-opus-20240229');
  });

  it('filters history to only user/assistant roles', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              response_text: 'hi',
              confidence_score: 0.9,
              requires_human: false,
              suggested_action: 'reply',
              internal_reasoning: 'x',
            }),
          },
        ],
      }),
    });

    await orchestrateAIResponse(1, [
      { role: 'system', content: 'ignored' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
      { role: 'tool', content: 'ignored' },
      { role: 'user', content: 'How are you?' },
    ]);

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.messages).toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
      { role: 'user', content: 'How are you?' },
    ]);
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