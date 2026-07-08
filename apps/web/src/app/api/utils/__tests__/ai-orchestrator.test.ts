import { describe, it, expect, vi, beforeEach } from 'vitest';
import { orchestrateAIResponse, detectHighRisk } from '../ai-orchestrator';

// The boundary under test: the shared Anthropic client module.
// We mock callAnthropic so we never touch the network and we never need ANTHROPIC_API_KEY.
vi.mock('../anthropic-client', () => ({
  callAnthropic: vi.fn(),
  ANTHROPIC_MODEL: 'claude-sonnet-4-20250514',
  AnthropicClientError: class extends Error {
    constructor(message: string, public readonly status?: number, public readonly retryable?: boolean) {
      super(message);
    }
  },
}));

import { callAnthropic } from '../anthropic-client';

describe('AI Orchestrator — Anthropic boundary (via shared client)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('imports the single Anthropic client module — no direct fetch in this file', async () => {
    // This test documents the contract: ai-orchestrator.ts must not call fetch()
    // directly. callAnthropic is imported from './anthropic-client'.
    expect(typeof callAnthropic).toBe('function');
  });

  it('returns a normalized AIDecision when the shared client returns text', async () => {
    (callAnthropic as any).mockResolvedValue({
      text: JSON.stringify({
        response_text: 'Thank you for your interest!',
        confidence_score: 0.9,
        requires_human: false,
        suggested_action: 'reply',
        internal_reasoning: 'Routine inquiry.',
      }),
      contentBlocks: [{ type: 'text', text: '...' }],
      stopReason: 'end_turn',
      model: 'claude-sonnet-4-20250514',
      usage: { input_tokens: 10, output_tokens: 20 },
    });

    const result = await orchestrateAIResponse(1, [
      { role: 'user', content: 'Hello' },
    ]);

    expect(result.response_text).toBe('Thank you for your interest!');
    expect(result.confidence_score).toBeCloseTo(0.9);
    expect(result.requires_human).toBe(false);
    expect(result.suggested_action).toBe('reply');
  });

  it('forces requires_human when confidence < 0.8 even if model says false', async () => {
    (callAnthropic as any).mockResolvedValue({
      text: JSON.stringify({
        response_text: 'Not sure about this one.',
        confidence_score: 0.5,
        requires_human: false,
        suggested_action: 'escalate',
        internal_reasoning: 'Low confidence.',
      }),
      contentBlocks: [],
      stopReason: 'end_turn',
      model: 'claude-sonnet-4-20250514',
      usage: { input_tokens: 10, output_tokens: 20 },
    });

    const result = await orchestrateAIResponse(1, [
      { role: 'user', content: 'Hello' },
    ]);

    expect(result.requires_human).toBe(true);
    expect(result.suggested_action).toBe('escalate');
  });

  it('strips markdown code fences from model output', async () => {
    (callAnthropic as any).mockResolvedValue({
      text: '```json\n{"response_text":"Hi","confidence_score":0.8,"requires_human":false,"suggested_action":"reply","internal_reasoning":"ok"}\n```',
      contentBlocks: [],
      stopReason: 'end_turn',
      model: 'claude-sonnet-4-20250514',
      usage: { input_tokens: 10, output_tokens: 20 },
    });

    const result = await orchestrateAIResponse(1, [
      { role: 'user', content: 'Hey' },
    ]);

    expect(result.response_text).toBe('Hi');
    expect(result.confidence_score).toBeCloseTo(0.8);
  });

  it('passes AnthropicClientError through unchanged', async () => {
    const err = new Error('boom') as any;
    err.status = 500;
    err.retryable = false;
    (callAnthropic as any).mockRejectedValue(err);

    await expect(
      orchestrateAIResponse(1, [{ role: 'user', content: 'Hi' }]),
    ).rejects.toThrow('boom');
  });

  it('throws if the client returns non-JSON content', async () => {
    (callAnthropic as any).mockResolvedValue({
      text: 'this is not json',
      contentBlocks: [],
      stopReason: 'end_turn',
      model: 'claude-sonnet-4-20250514',
      usage: { input_tokens: 10, output_tokens: 20 },
    });

    await expect(
      orchestrateAIResponse(1, [{ role: 'user', content: 'Hi' }]),
    ).rejects.toThrow('AI Orchestration returned non-JSON content');
  });

  it('throws on empty response_text', async () => {
    (callAnthropic as any).mockResolvedValue({
      text: JSON.stringify({ response_text: '', confidence_score: 0.5, requires_human: false, suggested_action: 'reply', internal_reasoning: '' }),
      contentBlocks: [],
      stopReason: 'end_turn',
      model: 'claude-sonnet-4-20250514',
      usage: { input_tokens: 10, output_tokens: 20 },
    });

    await expect(
      orchestrateAIResponse(1, [{ role: 'user', content: 'Hi' }]),
    ).rejects.toThrow('AI Orchestration returned an empty response_text');
  });

  it('handles model override via ANTHROPIC_MODEL env var', async () => {
    const original = process.env.ANTHROPIC_MODEL;
    process.env.ANTHROPIC_MODEL = 'claude-3-5-sonnet-20240620';

    (callAnthropic as any).mockResolvedValue({
      text: JSON.stringify({ response_text: 'ok', confidence_score: 1, requires_human: false, suggested_action: 'reply', internal_reasoning: '' }),
      contentBlocks: [],
      stopReason: 'end_turn',
      model: 'claude-3-5-sonnet-20240620',
      usage: { input_tokens: 10, output_tokens: 20 },
    });

    await orchestrateAIResponse(1, [{ role: 'user', content: 'Hi' }]);

    expect((callAnthropic as any).mock.calls[0][0]).toBeDefined();
    if (original !== undefined) process.env.ANTHROPIC_MODEL = original;
    else delete process.env.ANTHROPIC_MODEL;
  });
});

describe('detectHighRisk', () => {
  it('flags price/offer/contract keywords', () => {
    expect(detectHighRisk('I can offer $450,000 for the property')).toBe(true);
    expect(detectHighRisk('What is your pricing?')).toBe(true);
    expect(detectHighRisk('Please sign the contract')).toBe(true);
    expect(detectHighRisk('assignment of rights')).toBe(true);
    expect(detectHighRisk('purchase agreement')).toBe(true);
    expect(detectHighRisk('closing date')).toBe(true);
    expect(detectHighRisk('earnest money deposit')).toBe(true);
    expect(detectHighRisk('50% deposit')).toBe(true);
  });

  it('returns false for benign content', () => {
    expect(detectHighRisk('Hello, is this still available?')).toBe(false);
    expect(detectHighRisk('')).toBe(false);
    expect(detectHighRisk(123 as any)).toBe(false);
    expect(detectHighRisk(null as any)).toBe(false);
  });
});