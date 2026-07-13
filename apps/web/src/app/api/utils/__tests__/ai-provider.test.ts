import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getAiConfig } = vi.hoisted(() => ({ getAiConfig: vi.fn() }));
const { callAnthropic } = vi.hoisted(() => ({ callAnthropic: vi.fn(async () => ({ text: 'A', model: 'claude', usage: {}, contentBlocks: [], stopReason: 'stop' })) }));
const { callOllama } = vi.hoisted(() => ({ callOllama: vi.fn(async () => ({ text: 'O', model: 'llama3.1:8b', usage: {}, contentBlocks: [], stopReason: 'stop' })) }));

vi.mock('../ai-settings', () => ({ getAiConfig }));
vi.mock('../anthropic-client', () => ({ callAnthropic, AnthropicClientError: class extends Error {} }));
vi.mock('../ollama-client', () => ({ callOllama }));

import { callAI } from '../ai-provider';

beforeEach(() => vi.clearAllMocks());

describe('callAI — routes to the active provider', () => {
  it('uses Anthropic when provider=anthropic (default)', async () => {
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
