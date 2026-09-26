/**
 * Apollo.io integration configuration (server-side only).
 *
 * The API key lives in the environment / Cloudflare Worker secrets
 * (`wrangler secret put APOLLO_API_KEY`) and is NEVER logged, returned, or
 * embedded in a client bundle. When the key is absent the consumer must fail
 * with a PRECISE configuration error (code APOLLO_NOT_CONFIGURED) instead of
 * pretending the integration works.
 */
export interface ApolloConfig {
  apiKey: string;
  baseUrl: string;
  searchPath: string;
  timeoutMs: number;
  maxPerPage: number;
}

export type ApolloConfigResult =
  | { ok: true; config: ApolloConfig }
  | { ok: false; code: 'APOLLO_NOT_CONFIGURED'; missing: string[]; error: string };

const DEFAULTS = {
  baseUrl: 'https://api.apollo.io',
  searchPath: '/api/v1/mixed_people/search',
  timeoutMs: 15_000,
  maxPerPage: 100,
} as const;

/** Resolve and validate Apollo configuration. Never exposes the API key. */
export function getApolloConfig(): ApolloConfigResult {
  const missing: string[] = [];

  const apiKey = (process.env.APOLLO_API_KEY ?? '').trim();
  if (!apiKey) missing.push('APOLLO_API_KEY');

  if (missing.length > 0) {
    return {
      ok: false,
      code: 'APOLLO_NOT_CONFIGURED',
      missing,
      error:
        'Apollo.io lead source is not configured. Set the APOLLO_API_KEY worker secret ' +
        '(and optionally APOLLO_BASE_URL / APOLLO_SEARCH_PATH) to enable live pulls.',
    };
  }

  const rawBase = (process.env.APOLLO_BASE_URL ?? '').trim() || DEFAULTS.baseUrl;
  let baseUrl: string;
  try {
    const url = new URL(rawBase);
    const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !isLocal) throw new Error('insecure');
    baseUrl = url.origin;
  } catch {
    return {
      ok: false,
      code: 'APOLLO_NOT_CONFIGURED',
      missing: ['APOLLO_BASE_URL'],
      error: 'APOLLO_BASE_URL must be an absolute https URL (e.g. https://api.apollo.io).',
    };
  }

  const searchPath = (() => {
    const raw = (process.env.APOLLO_SEARCH_PATH ?? '').trim();
    if (!raw) return DEFAULTS.searchPath;
    return raw.startsWith('/') ? raw : `/${raw}`;
  })();

  const timeoutRaw = Number(process.env.APOLLO_TIMEOUT_MS);
  const timeoutMs =
    Number.isFinite(timeoutRaw) && timeoutRaw >= 1000 && timeoutRaw <= 60_000
      ? timeoutRaw
      : DEFAULTS.timeoutMs;

  return {
    ok: true,
    config: { apiKey, baseUrl, searchPath, timeoutMs, maxPerPage: DEFAULTS.maxPerPage },
  };
}
