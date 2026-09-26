/**
 * Apollo client + config tests — offline, deterministic (injected fetch/sleep).
 * Verifies retry/rate-limit/timeout/auth behavior AND that the API key can
 * never leak into an error message.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apolloSearchPeople, ApolloApiError } from './client';
import { getApolloConfig, type ApolloConfig } from './config';

const CONFIG: ApolloConfig = {
  apiKey: 'sk-SECRET-XYZ-DO-NOT-LEAK',
  baseUrl: 'https://api.apollo.io',
  searchPath: '/api/v1/mixed_people/search',
  timeoutMs: 5_000,
  maxPerPage: 100,
};

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const sleepSpy = vi.fn(async (_ms: number) => {});

describe('apolloSearchPeople', () => {
  beforeEach(() => {
    sleepSpy.mockClear();
  });

  it('performs a keyed POST and parses people[]', async () => {
    const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => {
      expect(String(url)).toBe('https://api.apollo.io/api/v1/mixed_people/search');
      expect(init?.method).toBe('POST');
      const headers = init?.headers as Record<string, string>;
      expect(headers['x-api-key']).toBe(CONFIG.apiKey);
      const body = JSON.parse(String(init?.body));
      expect(body.page).toBe(1);
      expect(body.per_page).toBe(25);
      expect(body.person_titles).toEqual(['CEO']);
      expect(body.q_keywords).toBe('wholesale');
      return jsonResponse(200, { people: [{ id: 1 }, { id: 2 }], total_entries: 900 });
    }) as unknown as typeof fetch;

    const result = await apolloSearchPeople(
      CONFIG,
      { page: 1, perPage: 25, titles: ['CEO'], query: 'wholesale' },
      { fetchImpl, sleep: sleepSpy }
    );

    expect(result.people).toHaveLength(2);
    expect(result.total).toBe(900);
    expect(result.retriesUsed).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('clamps perPage to maxPerPage', async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.per_page).toBe(100);
      return jsonResponse(200, { people: [] });
    }) as unknown as typeof fetch;

    await apolloSearchPeople(CONFIG, { page: 1, perPage: 5_000 }, { fetchImpl, sleep: sleepSpy });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('429 honors Retry-After, retries, then succeeds', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      if (calls === 1) return jsonResponse(429, { error: 'slow down' }, { 'retry-after': '2' });
      return jsonResponse(200, { people: [{ id: 1 }] });
    }) as unknown as typeof fetch;

    const result = await apolloSearchPeople(
      CONFIG,
      { page: 1, perPage: 10 },
      { fetchImpl, sleep: sleepSpy }
    );

    expect(result.people).toHaveLength(1);
    expect(result.retriesUsed).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleepSpy).toHaveBeenCalledWith(2_000);
  });

  it('persistent 429 throws RATE_LIMITED after bounded retries (never loops)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(429, {}, { 'retry-after': '1' })
    ) as unknown as typeof fetch;

    const err = await apolloSearchPeople(
      CONFIG,
      { page: 1, perPage: 10 },
      { fetchImpl, sleep: sleepSpy }
    ).catch((e) => e);

    expect(err).toBeInstanceOf(ApolloApiError);
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.status).toBe(429);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleepSpy).toHaveBeenCalledTimes(2);
  });

  it('401 fails fast with AUTH_FAILED and NEVER leaks the API key', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, { error: 'bad key' })) as unknown as typeof fetch;

    const err = await apolloSearchPeople(
      CONFIG,
      { page: 1, perPage: 10 },
      { fetchImpl, sleep: sleepSpy }
    ).catch((e) => e);

    expect(err).toBeInstanceOf(ApolloApiError);
    expect(err.code).toBe('AUTH_FAILED');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(err.message)).not.toContain(CONFIG.apiKey);
    expect(String(err.message)).not.toContain('bad key');
  });

  it('5xx retries once then succeeds', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      if (calls === 1) return jsonResponse(503, {});
      return jsonResponse(200, { people: [] });
    }) as unknown as typeof fetch;

    const result = await apolloSearchPeople(
      CONFIG,
      { page: 1, perPage: 10 },
      { fetchImpl, sleep: sleepSpy }
    );
    expect(result.retriesUsed).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('network failure throws NETWORK after bounded retries', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;

    const err = await apolloSearchPeople(
      CONFIG,
      { page: 1, perPage: 10 },
      { fetchImpl, sleep: sleepSpy }
    ).catch((e) => e);

    expect(err).toBeInstanceOf(ApolloApiError);
    expect(err.code).toBe('NETWORK');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('rejects a response without people[] (INVALID_RESPONSE)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { unexpected: true })) as unknown as typeof fetch;

    const err = await apolloSearchPeople(
      CONFIG,
      { page: 1, perPage: 10 },
      { fetchImpl, sleep: sleepSpy }
    ).catch((e) => e);

    expect(err).toBeInstanceOf(ApolloApiError);
    expect(err.code).toBe('INVALID_RESPONSE');
  });

  it('400 fails fast as BAD_REQUEST', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(400, {})) as unknown as typeof fetch;
    const err = await apolloSearchPeople(
      CONFIG,
      { page: 1, perPage: 10 },
      { fetchImpl, sleep: sleepSpy }
    ).catch((e) => e);
    expect(err.code).toBe('BAD_REQUEST');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('getApolloConfig', () => {
  const KEYS = ['APOLLO_API_KEY', 'APOLLO_BASE_URL', 'APOLLO_SEARCH_PATH', 'APOLLO_TIMEOUT_MS'] as const;
  const saved: Record<string, string | undefined> = {};
  for (const k of KEYS) saved[k] = process.env[k];

  beforeEach(() => {
    for (const k of KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('reports a precise configuration error when the key is missing', () => {
    const result = getApolloConfig();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('APOLLO_NOT_CONFIGURED');
      expect(result.missing).toEqual(['APOLLO_API_KEY']);
      expect(result.error).toContain('APOLLO_API_KEY');
      expect(result.error).not.toContain('secret value');
    }
  });

  it('rejects an insecure APOLLO_BASE_URL', () => {
    process.env.APOLLO_API_KEY = 'k';
    process.env.APOLLO_BASE_URL = 'http://evil.example.com';
    const result = getApolloConfig();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missing).toEqual(['APOLLO_BASE_URL']);
  });

  it('resolves defaults when configured', () => {
    process.env.APOLLO_API_KEY = 'k';
    const result = getApolloConfig();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.baseUrl).toBe('https://api.apollo.io');
      expect(result.config.searchPath).toBe('/api/v1/mixed_people/search');
      expect(result.config.maxPerPage).toBe(100);
      expect(result.config.timeoutMs).toBe(15_000);
    }
  });
});
