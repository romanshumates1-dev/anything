/**
 * Local open-source model backend via Ollama, behind the SAME interface as the
 * Anthropic client (Anthropic-messages shape in/out) so callers are
 * provider-agnostic. Enabled by the AI provider toggle (see ai-settings.ts).
 *
 * Uses Ollama's native /api/chat (stream:false). Run a 6–8 GB model locally:
 *   ollama serve            # starts the server on :11434
 *   ollama pull llama3.1:8b # ~4.7 GB; or qwen2.5:7b, mistral:7b
 */
import {
  AnthropicClientError,
  type AnthropicCallOptions,
  type AnthropicResponse,
} from './anthropic-client';

const REQUEST_TIMEOUT_MS = 120_000; // local models can be slower than the API
const MAX_RETRIES = 1;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const timer = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Ollama request timed out after ${ms}ms`)), ms)
  );
  return Promise.race([promise, timer]);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface OllamaOptions {
  baseUrl: string;
  model: string;
}

/**
 * Call a local Ollama model and return an AnthropicResponse-shaped result.
 * Throws AnthropicClientError on failure (shared taxonomy → the orchestrator's
 * existing error handling works unchanged).
 */
export async function callOllama(
  options: AnthropicCallOptions,
  cfg: OllamaOptions
): Promise<AnthropicResponse> {
  const { messages, system, maxTokens = 1024, raw = false, json = false } = options;

  const hasUserLast = messages.length > 0 && messages[messages.length - 1].role === 'user';
  const chatMessages = [
    ...(system ? [{ role: 'system', content: system }] : []),
    ...messages,
    ...(hasUserLast ? [] : [{ role: 'user', content: 'Please respond.' }]),
  ];

  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/api/chat`;
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: chatMessages,
    stream: false,
    options: { num_predict: maxTokens },
  };
  // Constrain the model to valid JSON when the caller expects it. Small local
  // models emit loose key:value text without this, breaking JSON.parse.
  if (json) body.format = 'json';

  let lastError: AnthropicClientError | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await withTimeout(
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
        REQUEST_TIMEOUT_MS
      );

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        const retryable = res.status >= 500;
        const err = new AnthropicClientError(
          `Ollama error [${res.status}]: ${errBody || res.statusText}`,
          res.status,
          retryable
        );
        if (retryable && attempt < MAX_RETRIES) {
          await sleep(750);
          continue;
        }
        throw err;
      }

      const data: any = await res.json();
      const text = typeof data?.message?.content === 'string' ? data.message.content : '';
      if (!text.trim()) {
        throw new AnthropicClientError('Ollama returned an empty response', undefined, false);
      }

      return {
        text,
        contentBlocks: raw ? [{ type: 'text', text }] : [],
        stopReason: typeof data?.done_reason === 'string' ? data.done_reason : 'stop',
        model: typeof data?.model === 'string' ? data.model : cfg.model,
        usage: {
          input_tokens: typeof data?.prompt_eval_count === 'number' ? data.prompt_eval_count : 0,
          output_tokens: typeof data?.eval_count === 'number' ? data.eval_count : 0,
        },
      };
    } catch (err: any) {
      if (err instanceof AnthropicClientError && !err.retryable) throw err;
      // A bare fetch failure here is almost always "server not running".
      const isConn = err?.cause?.code === 'ECONNREFUSED' || /fetch failed|ECONNREFUSED/i.test(String(err?.message));
      lastError =
        err instanceof AnthropicClientError
          ? err
          : new AnthropicClientError(
              isConn
                ? `Ollama not reachable at ${cfg.baseUrl} — is \`ollama serve\` running and \`${cfg.model}\` pulled?`
                : String(err?.message || err),
              undefined,
              false,
              err
            );
      if (lastError && !lastError.retryable) throw lastError;
      if (attempt < MAX_RETRIES) await sleep(750);
    }
  }
  throw lastError ?? new AnthropicClientError('Ollama request failed', undefined, false);
}
