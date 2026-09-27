/**
 * Tax report API tests: period aggregation, date bounds, CSV export,
 * tenant scoping, and error hygiene.
 *
 * The assertion that matters most is the date_trunc one: it proves bucketing
 * happens IN SQL, so a large history cannot silently yield wrong period totals
 * the way client-side filtering of an already-loaded list would.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSql = vi.fn();
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

const mockGetSession = vi.fn();
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: () => mockGetSession() } },
}));

const mockGetOrganization = vi.fn();
vi.mock('@/lib/organization-context', () => ({
  getOrganization: () => mockGetOrganization(),
}));

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

const SELLER = { id: 'user_A', email: 'a@example.com' };
const ORG_A = { id: 'org_A', name: 'Org A' };

const importReport = () => import('@/app/api/tax/report/route');

const FROM = '2026-07-01T00:00:00.000Z';
const TO = '2026-09-30T23:59:59.000Z';

async function getReport(query = '') {
  const { GET } = await importReport();
  return GET(new Request(`http://x/api/tax/report?from=${FROM}&to=${TO}${query}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue({ user: SELLER });
  mockGetOrganization.mockResolvedValue(ORG_A);
});

describe('GET /api/tax/report', () => {
  it('rejects an unauthenticated caller', async () => {
    mockGetSession.mockResolvedValueOnce(null);
    expect((await getReport()).status).toBe(401);
  });

  it('rejects an inverted date range', async () => {
    mockSql.mockResolvedValue([]);
    const { GET } = await importReport();
    const res = await GET(new Request('http://x/api/tax/report?from=2026-09-30&to=2026-07-01'));
    expect(res.status).toBe(400);
  });

  it('rejects a range beyond the 3-year bound', async () => {
    mockSql.mockResolvedValue([]);
    const { GET } = await importReport();
    const res = await GET(new Request('http://x/api/tax/report?from=2000-01-01&to=2026-09-30'));
    expect(res.status).toBe(400);
  });

  it('ignores an unknown period and falls back to quarter', async () => {
    mockSql.mockResolvedValue([]);
    const body = await (await getReport('&period=fortnightly')).json();
    expect(body.period).toBe('quarter');
  });

  it.each(['day', 'week', 'month', 'quarter', 'year'])(
    'accepts the %s granularity and buckets in SQL',
    async (period) => {
      const seen: string[] = [];
      mockSql.mockImplementation((strings: TemplateStringsArray) => {
        seen.push(strings.join(' '));
        return Promise.resolve([]);
      });
      const res = await getReport(`&period=${period}`);
      expect(res.status).toBe(200);
      expect((await res.json()).period).toBe(period);
      // date_trunc + GROUP BY is what proves the bucketing is in the database.
      expect(seen.some((s) => s.includes('date_trunc') && s.includes('GROUP BY'))).toBe(true);
    }
  );

  it('scopes every aggregate to the session user AND organization', async () => {
    const seen: string[] = [];
    mockSql.mockImplementation((strings: TemplateStringsArray) => {
      seen.push(strings.join(' '));
      return Promise.resolve([]);
    });
    await getReport();
    const aggs = seen.filter((s) => s.includes('FROM earnings') || s.includes('FROM withdrawals'));
    expect(aggs.length).toBeGreaterThan(0);
    for (const q of aggs) {
      expect(q, 'aggregate missing tenant predicate').toContain('user_id');
      expect(q, 'aggregate missing tenant predicate').toContain('organization_id');
    }
  });

  it('reports a no-activity seller as zeroes, not nulls or NaN', async () => {
    mockSql.mockResolvedValue([]);
    const body = await (await getReport()).json();
    expect(body.totals.grossCents).toBe(0);
    expect(body.totals.withheldCents).toBe(0);
    expect(Number.isNaN(body.totals.netReceivedCents)).toBe(false);
    expect(body.periods).toEqual([]);
  });

  it('always carries the estimate disclaimer', async () => {
    mockSql.mockResolvedValue([]);
    expect((await (await getReport()).json()).disclaimer).toMatch(/not a tax form/i);
  });

  it('exports CSV with the disclaimer embedded and no-store caching', async () => {
    mockSql.mockResolvedValue([]);
    const res = await getReport('&format=csv');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('attachment');
    // Seller financial data must not be cacheable by a shared proxy.
    expect(res.headers.get('cache-control')).toBe('no-store');
    const csv = await res.text();
    expect(csv).toMatch(/not a tax form/i);
    expect(csv).toContain('net_withheld_cents');
  });

  it('aggregates earnings rows into period totals', async () => {
    mockSql.mockImplementation((strings: TemplateStringsArray) => {
      const text = strings.join(' ');
      if (text.includes('FROM earnings')) {
        return Promise.resolve([
          { bucket: '2026-07-01T00:00:00.000Z', gross: 100000, refunded: 0, withdrawn: 40000, pending: 10000, available: 50000 },
        ]);
      }
      return Promise.resolve([]);
    });
    const body = await (await getReport()).json();
    expect(body.totals.grossCents).toBe(100000);
    expect(body.balances.availableCents).toBe(50000);
    expect(body.balances.pendingCents).toBe(10000);
    expect(body.periods[0].grossCents).toBe(100000);
  });

  it('returns 500 without leaking the internal database error', async () => {
    mockSql.mockRejectedValue(new Error('connection to db-primary-3.internal failed'));
    const res = await getReport();
    expect(res.status).toBe(500);
    // The internal hostname from the thrown error must not reach the client.
    expect(await res.text()).not.toContain('db-primary-3');
  });
});
