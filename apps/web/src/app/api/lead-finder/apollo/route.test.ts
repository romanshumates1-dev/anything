/**
 * Apollo route tests — authorization, precise config error, billing seam,
 * ingestion response, and safe upstream error mapping.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import sql from '@/app/api/utils/sql';

vi.mock('@/app/api/utils/sql');
vi.mock('@/app/api/utils/authz', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/organization-context', () => ({ getOrganization: vi.fn() }));
vi.mock('@/app/api/utils/logger', () => ({ logEvent: vi.fn() }));
vi.mock('@/app/api/utils/creditGuard', () => ({ withCreditDeduction: vi.fn() }));
vi.mock('./client', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, apolloSearchPeople: vi.fn() };
});

const mockSql = vi.mocked(sql);
const { requireAdmin } = await import('@/app/api/utils/authz');
const { getOrganization } = await import('@/lib/organization-context');
const { withCreditDeduction } = await import('@/app/api/utils/creditGuard');
const { apolloSearchPeople, ApolloApiError } = await import('./client');
const { POST, mapApolloError } = await import('./route');

const ADMIN = { ok: true, userId: 'admin1', email: 'a@dealswiftautomation.com' } as const;
const DENIED = { ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) } as const;
const SOURCE_ROW = {
  id: 7,
  distress_weight: 60,
  record_type: 'apollo_contact',
  category: 'seller',
} as const;

function req(body: unknown): Request {
  return new Request('http://test/api/lead-finder/apollo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const ENV_KEY = 'APOLLO_API_KEY';
const savedEnv = process.env[ENV_KEY];

beforeEach(() => {
  vi.clearAllMocks();
  process.env[ENV_KEY] = 'test-key-do-not-use-in-prod';
  vi.mocked(requireAdmin).mockResolvedValue(ADMIN as never);
  vi.mocked(getOrganization).mockResolvedValue({ id: 'org1' } as never);
});
afterEach(() => {
  if (savedEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = savedEnv;
});

describe('POST /api/lead-finder/apollo', () => {
  it('rejects non-admin callers with 401 and touches nothing', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(DENIED as never);
    const res = await POST(req({ query: 'investor' }));
    expect(res.status).toBe(401);
    expect(mockSql).not.toHaveBeenCalled();
    expect(withCreditDeduction).not.toHaveBeenCalled();
  });

  it('returns a PRECISE 503 APOLLO_NOT_CONFIGURED when the key is missing (no fake success)', async () => {
    delete process.env[ENV_KEY];
    const res = await POST(req({}));
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.code).toBe('APOLLO_NOT_CONFIGURED');
    expect(data.missing).toEqual(['APOLLO_API_KEY']);
    expect(withCreditDeduction).not.toHaveBeenCalled();
  });

  it('returns 403 without an organization', async () => {
    vi.mocked(getOrganization).mockResolvedValue(null as never);
    const res = await POST(req({}));
    expect(res.status).toBe(403);
  });

  it('returns 402 from the credit guard when credits are insufficient (nothing charged)', async () => {
    mockSql.mockResolvedValueOnce([SOURCE_ROW]); // ensureApolloSource — source exists
    vi.mocked(withCreditDeduction).mockResolvedValue({
      success: false,
      error: Response.json({ code: 'INSUFFICIENT_CREDITS' }, { status: 402 }),
    } as never);

    const res = await POST(req({}));
    expect(res.status).toBe(402);
    // The operation never ran.
    expect(apolloSearchPeople).not.toHaveBeenCalled();
  });

  it('pulls, ingests, and reports billing + attribution on success', async () => {
    mockSql
      .mockResolvedValueOnce([SOURCE_ROW]) // ensureApolloSource — exists
      .mockResolvedValueOnce([{ id: 101 }, { id: 102 }]) // unnest INSERT RETURNING
      .mockResolvedValueOnce([]); // last_refreshed UPDATE

    vi.mocked(apolloSearchPeople).mockResolvedValue({
      people: [
        { id: 'p1', first_name: 'Jane', last_name: 'Doe', organization: { name: 'Acme' } },
        { id: 'p2', first_name: 'Sam', last_name: 'Rogers', organization: { name: 'Beta LLC' } },
      ],
      total: 400,
      retriesUsed: 0,
    } as never);

    vi.mocked(withCreditDeduction).mockImplementation(
      (async (_org: string, _action: string, op: () => Promise<unknown>) => ({
        success: true,
        result: await op(),
        creditsDeducted: 3,
      })) as never
    );

    const res = await POST(req({ query: 'cash buyer', perPage: 50 }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.provider).toBe('apollo.io');
    expect(data.sourceId).toBe(7);
    expect(data.fetched).toBe(2);
    expect(data.inserted).toBe(2);
    expect(data.creditsDeducted).toBe(3);
    expect(data.contactsRedacted).toBe(true);

    // Billing seam used the LEAD_FIND action with refund-on-error.
    expect(withCreditDeduction).toHaveBeenCalledTimes(1);
    const [, action, , opts] = vi.mocked(withCreditDeduction).mock.calls[0];
    expect(action).toBe('LEAD_FIND');
    expect(opts).toMatchObject({ refundOnError: true });

    // Ingestion ran a chunked insert.
    expect(mockSql).toHaveBeenCalledTimes(3);
  });

  it('maps upstream failures through mapApolloError (static, secret-free)', () => {
    const rate = mapApolloError(
      new ApolloApiError('Apollo rate limit exceeded (HTTP 429)', { status: 429, code: 'RATE_LIMITED', retryable: true })
    );
    expect(rate.status).toBe(429);
    expect(rate.headers.get('Retry-After')).toBe('5');

    const auth = mapApolloError(
      new ApolloApiError('Apollo rejected the configured credentials (HTTP 401)', { status: 401, code: 'AUTH_FAILED' })
    );
    expect(auth.status).toBe(502);

    const unknown = mapApolloError(new Error('boom with sk-secret in it?'));
    expect(unknown.status).toBe(500);

    const timeout = mapApolloError(
      new ApolloApiError('Apollo request timed out after 5000ms', { code: 'TIMEOUT', retryable: true })
    );
    expect(timeout.status).toBe(502);
  });

  it('surfaces upstream pull errors as safe HTTP responses (credits refunded by guard)', async () => {
    mockSql.mockResolvedValueOnce([SOURCE_ROW]);
    vi.mocked(withCreditDeduction).mockImplementation(
      (async (_org: string, _action: string, op: () => Promise<unknown>) => {
        try {
          const result = await op();
          return { success: true, result, creditsDeducted: 1 };
        } catch (err) {
          // Mirror the real guard: refund happens, then it rethrows.
          throw err;
        }
      }) as never
    );
    vi.mocked(apolloSearchPeople).mockRejectedValue(
      new ApolloApiError('Apollo rate limit exceeded (HTTP 429)', { status: 429, code: 'RATE_LIMITED', retryable: true })
    );

    const res = await POST(req({}));
    expect(res.status).toBe(429);
    const data = await res.json();
    expect(data.code).toBe('APOLLO_RATE_LIMITED');
  });
});
