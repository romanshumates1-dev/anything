import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { getAiConfig } = vi.hoisted(() => ({ getAiConfig: vi.fn() }));
const { callAnthropic } = vi.hoisted(() => ({ callAnthropic: vi.fn(async () => ({ text: 'A', model: 'claude', usage: {}, contentBlocks: [], stopReason: 'stop' })) }));
const { callOllama } = vi.hoisted(() => ({ callOllama: vi.fn(async () => ({ text: 'O', model: 'llama3.1:8b', usage: {}, contentBlocks: [], stopReason: 'stop' })) }));
const { callBedrock, getBedrockConfig } = vi.hoisted(() => ({ callBedrock: vi.fn(), getBedrockConfig: vi.fn(() => null) }));

vi.mock('../ai-settings', () => ({ getAiConfig }));
vi.mock('../anthropic-client', () => ({ callAnthropic, AnthropicClientError: class extends Error {} }));
vi.mock('../ollama-client', () => ({ callOllama }));
vi.mock('../bedrock-client', () => ({ callBedrock, getBedrockConfig }));

import { callAI } from '../ai-provider';

const originalEnv = process.env.ANTHROPIC_API_KEY;
beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  if (originalEnv !== undefined) process.env.ANTHROPIC_API_KEY = originalEnv;
  else delete process.env.ANTHROPIC_API_KEY;
});

describe('callAI — routes to the active provider', () => {
  it('uses Anthropic when provider=anthropic and API key is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    getAiConfig.mockResolvedValue({ provider: 'anthropic', ollamaBaseUrl: 'x', ollamaModel: 'y' });
    const r = await callAI({ messages: [{ role: 'user', content: 'hi' }] });
    expect(r.text).toBe('A');
    expect(callAnthropic).toHaveBeenCalledOnce();
    expect(callOllama).not.toHaveBeenCalled();
  });

  it('uses Ollama when provider=ollama, passing base URL + model', async () => {
    getAiConfig.mockResolvedValue({ provider: 'ollama', ollamaBaseUrl: 'http://box:11434', ollamaModel: 'mistral:7b' });
    const r = await callAI({ messages: [{ role: 'user', content: 'hi' }] });
    expect(r.text).toBe('O');
    expect(callOllama).toHaveBeenCalledWith(expect.anything(), { baseUrl: 'http://box:11434', model: 'mistral:7b' });
    expect(callAnthropic).not.toHaveBeenCalled();
  });
});
