/**
 * POST /api/lead-finder/sources/[id]/fetch — PERMITTED-source automated fetch.
 *
 * The load-bearing behaviour is the TERMS GUARD. `lead_sources.terms_status` is
 * the registry's record of whether anyone has cleared a source for automated
 * access; MANUAL_ONLY means nobody has. If this endpoint fetched a MANUAL_ONLY
 * source, the registry's entire compliance design (006_lead_finder.sql) would
 * be decorative. It must not be overridable from the request.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockSql } = vi.hoisted(() => {
  const m: any = vi.fn(async () => []);
  m.transaction = vi.fn(async () => []);
  m.query = m;
  return { mockSql: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/app/api/utils/authz', () => ({ requireAdmin }));

vi.mock('@/app/api/utils/logger', () => ({ logEvent: vi.fn(async () => {}) }));

import { POST } from './route';

const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as any;
const req = (body: unknown = {}) =>
  new Request('http://t/api/lead-finder/sources/1/fetch', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as any;

const SOURCE = {
  id: 1,
  name: 'Louisville Metro Open Data',
  url: 'https://data.louisvilleky.gov/',
  dataset_id: 'abcd-1234',
  terms_status: 'PERMITTED',
  access_method: 'API',
  record_type: 'code_violation',
  category: 'seller',
  jurisdiction: 'Louisville Metro, KY',
  distress_weight: 80,
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, userId: 'admin-1' });
  mockSql.mockResolvedValue([]);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const upstream = (records: unknown[]) =>
  fetchMock.mockResolvedValue({ ok: true, json: async () => records });

describe('terms guard — the reason this endpoint exists', () => {
  it('REFUSES a MANUAL_ONLY source and never calls upstream', async () => {
    mockSql.mockResolvedValueOnce([{ ...SOURCE, terms_status: 'MANUAL_ONLY' }]);
    const res = await POST(req(), ctx('1'));
    expect(res.status).toBe(403);
    const b = await res.json();
    expect(b.error).toBe('automated_fetch_not_permitted');
    expect(b.termsStatus).toBe('MANUAL_ONLY');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('REFUSES a PROHIBITED source', async () => {
    mockSql.mockResolvedValueOnce([{ ...SOURCE, terms_status: 'PROHIBITED' }]);
    const res = await POST(req(), ctx('1'));
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cannot be overridden from the request body', async () => {
    mockSql.mockResolvedValueOnce([{ ...SOURCE, terms_status: 'MANUAL_ONLY' }]);
    const res = await POST(
      req({ termsStatus: 'PERMITTED', terms_status: 'PERMITTED', force: true }),
      ctx('1')
    );
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('404s an unknown source', async () => {
    mockSql.mockResolvedValueOnce([]);
    expect((await POST(req(), ctx('99'))).status).toBe(404);
  });

  it('400s a non-integer source id', async () => {
    expect((await POST(req(), ctx('abc'))).status).toBe(400);
  });

  it('rejects non-admin callers', async () => {
    requireAdmin.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'Forbidden' }, { status: 403 }),
    });
    expect((await POST(req(), ctx('1'))).status).toBe(403);
  });
});

describe('dataset configuration', () => {
  it('400s with a clear error when dataset_id is unset, rather than guessing', async () => {
    mockSql.mockResolvedValueOnce([{ ...SOURCE, dataset_id: null }]);
    const res = await POST(req(), ctx('1'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('source_missing_dataset');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('builds the SODA resource URL from the portal root + dataset id', async () => {
    mockSql.mockResolvedValueOnce([SOURCE]);
    upstream([]);
    await POST(req({ limit: 50, offset: 100 }), ctx('1'));
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('https://data.louisvilleky.gov/resource/abcd-1234.json');
    expect(url).toContain('%24limit=50');
    expect(url).toContain('%24offset=100');
  });
});

describe('ingestion', () => {
  it('parses, scores and inserts fetched records', async () => {
    mockSql.mockResolvedValueOnce([SOURCE]);
    upstream([
      { owner_name: 'Jane Owner', property_address: '12 Oak St' },
      { owner_name: 'Bob Owner', property_address: '14 Oak St' },
    ]);
    mockSql
      .mockResolvedValueOnce([{ id: 11 }]) // INSERT row 1
      .mockResolvedValueOnce([{ id: 12 }]) // INSERT row 2
      .mockResolvedValueOnce([]); // UPDATE lead_sources

    const b = await (await POST(req(), ctx('1'))).json();
    expect(b.fetched).toBe(2);
    expect(b.inserted).toBe(2);
    expect(b.failed).toBe(0);
  });

  it('never persists contact data present in the upstream payload', async () => {
    mockSql.mockResolvedValueOnce([SOURCE]);
    upstream([
      { owner_name: 'Jane', property_address: '12 Oak St', phone: '5025550123', email: 'j@x.com' },
    ]);
    mockSql.mockResolvedValueOnce([{ id: 11 }]).mockResolvedValueOnce([]);

    await POST(req(), ctx('1'));
    const allArgs = JSON.stringify(mockSql.mock.calls);
    expect(allArgs).not.toContain('5025550123');
    expect(allArgs).not.toContain('j@x.com');
  });

  it('counts DB-deduped rows as duplicates, not inserts', async () => {
    mockSql.mockResolvedValueOnce([SOURCE]);
    upstream([{ owner_name: 'Jane', property_address: '12 Oak St' }]);
    mockSql
      .mockResolvedValueOnce([]) // INSERT ... ON CONFLICT DO NOTHING -> no row
      .mockResolvedValueOnce([]);

    const b = await (await POST(req(), ctx('1'))).json();
    expect(b.inserted).toBe(0);
    expect(b.duplicates).toBe(1);
  });
});

describe('pagination', () => {
  it('returns nextOffset when the page came back full', async () => {
    mockSql.mockResolvedValueOnce([SOURCE]);
    upstream([{ property_address: '1 A St' }, { property_address: '2 B St' }]);
    mockSql
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce([{ id: 2 }])
      .mockResolvedValueOnce([]);

    const b = await (await POST(req({ limit: 2, offset: 10 }), ctx('1'))).json();
    expect(b.morePossible).toBe(true);
    expect(b.nextOffset).toBe(12);
  });

  it('reports no more when the page came back partial', async () => {
    mockSql.mockResolvedValueOnce([SOURCE]);
    upstream([{ property_address: '1 A St' }]);
    mockSql.mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce([]);

    const b = await (await POST(req({ limit: 500 }), ctx('1'))).json();
    expect(b.morePossible).toBe(false);
    expect(b.nextOffset).toBeNull();
  });
});

describe('upstream failures are 502, not 500', () => {
  it('502s on a non-OK upstream response', async () => {
    mockSql.mockResolvedValueOnce([SOURCE]);
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    const res = await POST(req(), ctx('1'));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('upstream_error');
  });

  it('502s when the upstream payload is not an array', async () => {
    mockSql.mockResolvedValueOnce([SOURCE]);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ error: 'nope' }) });
    expect((await POST(req(), ctx('1'))).status).toBe(502);
  });

  it('502s on a network error instead of a blank 500', async () => {
    mockSql.mockResolvedValueOnce([SOURCE]);
    fetchMock.mockRejectedValue(new Error('ETIMEDOUT'));
    const res = await POST(req(), ctx('1'));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('upstream_unreachable');
  });
});
