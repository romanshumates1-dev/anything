/**
 * Single Anthropic Messages API client for the codebase.
 *
 * - One place for URL, header names, default model, retry/timeout policy.
 * - Both the conversation orchestrator and the negotiation worker path
 *   MUST import from here; direct fetch() calls are a boundary violation.
 *
 * Usage:
 *   import { callAnthropic, ANTHROPIC_MODEL } from '@/app/api/utils/anthropic-client';
 *   const text = await callAnthropic(messages, systemPrompt);
 */

// ---- constants --------------------------------------------------------------
export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_API_VERSION = '2023-06-01';
export const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

// ---- retry / timeout --------------------------------------------------------
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 2;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503]);

// ---- error taxonomy ---------------------------------------------------------
export class AnthropicClientError extends Error {
  constructor(
    message: string,
    public readonly status: number | undefined,
    public readonly retryable: boolean,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = 'AnthropicClientError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const timer = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`AI request timed out after ${ms}ms`)), ms),
  );
  return Promise.race([promise, timer]);
}

// ---- public API --------------------------------------------------------------
export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AnthropicCallOptions {
  messages: AnthropicMessage[];
  system?: string;
  maxTokens?: number;
  /** When true the caller wants the full raw content blocks (for debugging). */
  raw?: boolean;
}

export interface AnthropicContentBlock {
  type: 'text';
  text: string;
}

export interface AnthropicResponse {
  text: string;
  contentBlocks: AnthropicContentBlock[];
  stopReason: string;
  model: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * Call the Anthropic Messages API. Throws AnthropicClientError on failure.
 */
export async function callAnthropic(
  options: AnthropicCallOptions,
): Promise<AnthropicResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AnthropicClientError('ANTHROPIC_API_KEY is not configured', undefined, false);
  }

  const { messages, system, maxTokens = 1024, raw = false } = options;

  // Ensure there is at least one user message.
  const hasUserLast = messages.length > 0 && messages[messages.length - 1].role === 'user';
  const allMessages = hasUserLast
    ? messages
    : [...messages, { role: 'user' as const, content: 'Please respond.' }];

  const body: Record<string, unknown> = {
    model: ANTHROPIC_MODEL,
    max_tokens: maxTokens,
    messages: allMessages,
  };
  if (system) body.system = system;

  let lastError: AnthropicClientError | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await withTimeout(
        fetch(ANTHROPIC_MESSAGES_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_API_VERSION,
          },
          body: JSON.stringify(body),
        }),
        REQUEST_TIMEOUT_MS,
      );

      if (!res.ok) {
        const errorBody = await res.text().catch(() => '');
        const retryable = RETRYABLE_STATUSES.has(res.status);
        const err = new AnthropicClientError(
          `Anthropic API error [${res.status}]: ${errorBody || res.statusText}`,
          res.status,
          retryable,
        );
        if (retryable && attempt < MAX_RETRIES) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        throw err;
      }

      const data: any = await res.json();

      const contentBlocks: AnthropicContentBlock[] = Array.isArray(data?.content)
        ? data.content
        : [];
      const textBlock = contentBlocks.find((b) => b.type === 'text');
      const text = typeof textBlock?.text === 'string' ? textBlock.text : '';

      if (!text.trim()) {
        throw new AnthropicClientError('Anthropic returned an empty text response', undefined, false);
      }

      return {
        text,
        contentBlocks: raw ? contentBlocks : [],
        stopReason: typeof data?.stop_reason === 'string' ? data.stop_reason : 'unknown',
        model: typeof data?.model === 'string' ? data.model : ANTHROPIC_MODEL,
        usage: {
          input_tokens: typeof data?.usage?.input_tokens === 'number' ? data.usage.input_tokens : 0,
          output_tokens: typeof data?.usage?.output_tokens === 'number' ? data.usage.output_tokens : 0,
        },
      };
    } catch (err: any) {
      if (err instanceof AnthropicClientError && !err.retryable) throw err;
      lastError = err instanceof AnthropicClientError ? err : new AnthropicClientError(String(err), undefined, false, err);
      if (attempt < MAX_RETRIES) {
        await sleep(500 * 2 ** attempt);
      }
    }
  }

  throw lastError ?? new AnthropicClientError('AI request failed', undefined, false);
}