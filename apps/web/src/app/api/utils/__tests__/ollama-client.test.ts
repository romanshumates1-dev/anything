import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { callOllama } from '../ollama-client';
import { AnthropicClientError } from '../anthropic-client';

const CFG = { baseUrl: 'http://localhost:11434', model: 'llama3.1:8b' };

describe('callOllama — maps Ollama /api/chat → AnthropicResponse shape', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('maps content + token counts + model', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      model: 'llama3.1:8b',
      message: { role: 'assistant', content: 'hello there' },
      done_reason: 'stop',
      prompt_eval_count: 12,
      eval_count: 7,
    }), { status: 200 })));

    const r = await callOllama({ messages: [{ role: 'user', content: 'hi' }], system: 'be nice' }, CFG);
    expect(r.text).toBe('hello there');
    expect(r.model).toBe('llama3.1:8b');
    expect(r.stopReason).toBe('stop');
    expect(r.usage.input_tokens).toBe(12);
    expect(r.usage.output_tokens).toBe(7);
  });

  it('forces valid JSON via format:"json" when json:true (small local models emit loose text otherwise)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: { content: '{"ok":1}' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await callOllama({ messages: [{ role: 'user', content: 'q' }], json: true }, CFG);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.format).toBe('json');
  });

  it('omits format when json is not requested (free-text)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: { content: 'hi' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await callOllama({ messages: [{ role: 'user', content: 'q' }] }, CFG);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.format).toBeUndefined();
  });

  it('sends Authorization: Bearer when an apiKey is configured (for a tunnel-protected remote Ollama)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: { content: 'ok' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await callOllama({ messages: [{ role: 'user', content: 'q' }] }, { ...CFG, apiKey: 'secret-token' });
    const headers = (fetchMock.mock.calls[0][1] as any).headers;
    expect(headers.Authorization).toBe('Bearer secret-token');
  });

  it('omits Authorization when no apiKey (local, unauthenticated)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: { content: 'ok' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await callOllama({ messages: [{ role: 'user', content: 'q' }] }, CFG);
    const headers = (fetchMock.mock.calls[0][1] as any).headers;
    expect(headers.Authorization).toBeUndefined();
  });

  it('sends system + messages to /api/chat with stream:false', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: { content: 'ok' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await callOllama({ messages: [{ role: 'user', content: 'q' }], system: 'sys' }, CFG);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:11434/api/chat');
    const body = JSON.parse((init as any).body);
    expect(body.stream).toBe(false);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(body.messages.at(-1)).toEqual({ role: 'user', content: 'q' });
  });

  it('throws a helpful AnthropicClientError when the server is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { const e: any = new Error('fetch failed'); e.cause = { code: 'ECONNREFUSED' }; throw e; }));
    await expect(callOllama({ messages: [{ role: 'user', content: 'x' }] }, CFG)).rejects.toMatchObject({
      name: 'AnthropicClientError',
    });
    await expect(callOllama({ messages: [{ role: 'user', content: 'x' }] }, CFG)).rejects.toThrow(/ollama serve/i);
  });

  it('throws on an empty response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: { content: '' } }), { status: 200 })));
    await expect(callOllama({ messages: [{ role: 'user', content: 'x' }] }, CFG)).rejects.toBeInstanceOf(AnthropicClientError);
  });
});
