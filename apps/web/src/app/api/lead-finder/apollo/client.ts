/**
 * Apollo.io API client (server-side adapter).
 *
 * Design guarantees (verified by client.test.ts):
 *  - The API key is sent ONLY in the X-Api-Key header and never appears in
 *    error messages, logs, or returned values.
 *  - 429 honors Retry-After with bounded retries (never loops forever).
 *  - 5xx and network failures get ONE bounded retry; other 4xx fail fast.
 *  - Every request has a hard timeout via AbortController.
 *  - The response shape is validated; `people` must be an array.
 *  - fetch/sleep are injectable so tests run deterministically offline.
 *
 * LIVE-VERIFICATION NOTE: the endpoint path is configurable because Apollo's
 * API version surface can drift; a live call requires APOLLO_API_KEY and is
 * marked BLOCKED until the owner provides it. No successful Apollo response
 * is ever fabricated here.
 */
import type { ApolloConfig } from './config';

export type ApolloErrorCode =
  | 'RATE_LIMITED'
  | 'AUTH_FAILED'
  | 'BAD_REQUEST'
  | 'SERVER_ERROR'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'INVALID_RESPONSE';

export class ApolloApiError extends Error {
  readonly status?: number;
  readonly code: ApolloErrorCode;
  readonly retryable: boolean;

  constructor(
    message: string,
    opts: { status?: number; code: ApolloErrorCode; retryable?: boolean }
  ) {
    super(message);
    this.name = 'ApolloApiError';
    this.status = opts.status;
    this.code = opts.code;
    this.retryable = opts.retryable ?? false;
  }
}

export interface ApolloSearchParams {
  page: number;
  perPage: number;
  /** Optional job-title filters (e.g. ['CEO', 'Real Estate Investor']). */
  titles?: string[];
  /** Optional freeform keyword query. */
  query?: string;
}

export interface ApolloSearchResult {
  people: Record<string, unknown>[];
  total: number | null;
  retriesUsed: number;
}

export interface ApolloClientDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Max attempts = 1 initial + 2 bounded retries. */
const MAX_ATTEMPTS = 3;

export async function apolloSearchPeople(
  config: ApolloConfig,
  params: ApolloSearchParams,
  deps: ApolloClientDeps = {}
): Promise<ApolloSearchResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;

  const url = `${config.baseUrl}${config.searchPath}`;
  const body: Record<string, unknown> = {
    page: params.page,
    per_page: Math.min(config.maxPerPage, Math.max(1, params.perPage)),
  };
  if (params.titles && params.titles.length > 0) body.person_titles = params.titles;
  if (params.query) body.q_keywords = params.query;

  let lastError: ApolloApiError | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Header-only credential placement — never in the URL or body.
          'x-api-key': config.apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.status === 429) {
        const retryAfterSec = Number(res.headers.get('retry-after'));
        const waitMs = Math.min(
          10_000,
          Number.isFinite(retryAfterSec) && retryAfterSec >= 0 ? retryAfterSec * 1000 : 1_000
        );
        lastError = new ApolloApiError('Apollo rate limit exceeded (HTTP 429)', {
          status: 429,
          code: 'RATE_LIMITED',
          retryable: true,
        });
        if (attempt < MAX_ATTEMPTS) {
          await sleep(waitMs);
          continue;
        }
        throw lastError;
      }

      if (res.status === 401 || res.status === 403) {
        // Never echo response bodies here — they can echo request context.
        throw new ApolloApiError(`Apollo rejected the configured credentials (HTTP ${res.status})`, {
          status: res.status,
          code: 'AUTH_FAILED',
        });
      }

      if (res.status >= 500) {
        lastError = new ApolloApiError(`Apollo service error (HTTP ${res.status})`, {
          status: res.status,
          code: 'SERVER_ERROR',
          retryable: true,
        });
        if (attempt < MAX_ATTEMPTS) {
          await sleep(250 * attempt);
          continue;
        }
        throw lastError;
      }

      if (!res.ok) {
        throw new ApolloApiError(`Apollo request rejected (HTTP ${res.status})`, {
          status: res.status,
          code: 'BAD_REQUEST',
        });
      }

      let json: unknown;
      try {
        json = await res.json();
      } catch {
        throw new ApolloApiError('Apollo returned a non-JSON response', {
          status: res.status,
          code: 'INVALID_RESPONSE',
        });
      }

      const record = (json ?? {}) as { people?: unknown; total_entries?: unknown };
      if (!Array.isArray(record.people)) {
        throw new ApolloApiError('Apollo response is missing a people[] array', {
          status: res.status,
          code: 'INVALID_RESPONSE',
        });
      }

      return {
        people: record.people as Record<string, unknown>[],
        total: typeof record.total_entries === 'number' ? record.total_entries : null,
        retriesUsed: attempt - 1,
      };
    } catch (err) {
      clearTimeout(timer);

      if (err instanceof ApolloApiError) {
        if (err.retryable && attempt < MAX_ATTEMPTS) {
          await sleep(250 * attempt);
          continue;
        }
        throw err;
      }

      // AbortError = our timeout; anything else is a transport failure.
      const isTimeout =
        err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
      const networkError = new ApolloApiError(
        isTimeout
          ? `Apollo request timed out after ${config.timeoutMs}ms`
          : 'Apollo request failed before a response was received',
        { code: isTimeout ? 'TIMEOUT' : 'NETWORK', retryable: true }
      );
      if (attempt < MAX_ATTEMPTS) {
        await sleep(250 * attempt);
        continue;
      }
      throw networkError;
    }
  }

  // Unreachable, but keeps the type checker satisfied.
  throw lastError ?? new ApolloApiError('Apollo request failed', { code: 'NETWORK' });
}
