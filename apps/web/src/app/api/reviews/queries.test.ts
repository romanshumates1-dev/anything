/**
 * Aggregate-math + is_demo-exclusion tests for the reviews query helpers
 * (Prompt 1 Phase 2 DoD: "aggregate math unit-tested"). This is the same
 * logic GET /api/reviews and the /reviews server component both call —
 * see queries.ts for why is_demo/sort can't be composed as a sql fragment
 * (bug #27).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import sql from '@/app/api/utils/sql';

vi.mock('@/app/api/utils/sql');

const mockSql = vi.mocked(sql);

const { fetchReviewsPage } = await import('./queries');

describe('reviews queries', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.stubEnv('NODE_ENV', originalEnv || 'test');
  });

  it('computes average/count/distribution correctly from summary rows', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    // Call order inside fetchReviewsPage: list, total, aggregate, distribution.
    mockSql
      .mockResolvedValueOnce([{ id: 'r1', rating: 5, title: 't', body: 'b', created_at: '2026-01-01', is_demo: false, verified_customer: true, user_name: 'A' }]) // list
      .mockResolvedValueOnce([{ total: 10 }]) // total
      .mockResolvedValueOnce([{ average: '4.8', count: 10 }]) // aggregate
      .mockResolvedValueOnce([
        { rating: 5, n: 8 },
        { rating: 4, n: 1 },
        { rating: 3, n: 1 },
      ]); // distribution

    const result = await fetchReviewsPage({ page: 1, sort: null, stars: null });

    expect(result.aggregate.average).toBe(4.8);
    expect(result.aggregate.count).toBe(10);
    expect(result.aggregate.distribution).toEqual({ 1: 0, 2: 0, 3: 1, 4: 1, 5: 8 });
    expect(result.pagination).toEqual({ page: 1, limit: 10, total: 10, pages: 1 });
  });

  it('computes correct page count from total (ceil, not floor)', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    mockSql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: 25 }])
      .mockResolvedValueOnce([{ average: '4.5', count: 25 }])
      .mockResolvedValueOnce([]);

    const result = await fetchReviewsPage({ page: 1, sort: null, stars: null });

    // 25 rows / 10 per page = 2.5 -> must round UP to 3, not truncate to 2
    // (a floor here would silently hide the last 5 reviews from pagination).
    expect(result.pagination.pages).toBe(3);
  });

  it('defaults average/count to 0 when there are no reviews at all', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    mockSql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: 0 }])
      .mockResolvedValueOnce([{ average: null, count: 0 }])
      .mockResolvedValueOnce([]);

    const result = await fetchReviewsPage({ page: 1, sort: null, stars: null });

    expect(result.aggregate.average).toBe(0);
    expect(result.aggregate.count).toBe(0);
    expect(result.pagination.pages).toBe(1); // never 0 pages, even when empty
  });

  it('flags hasDemoData only outside production when a demo row is present', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    mockSql
      .mockResolvedValueOnce([{ id: 'r1', rating: 5, title: 't', body: 'b', created_at: '2026-01-01', is_demo: true, verified_customer: false, user_name: 'Demo D.' }])
      .mockResolvedValueOnce([{ total: 1 }])
      .mockResolvedValueOnce([{ average: '5.0', count: 1 }])
      .mockResolvedValueOnce([{ rating: 5, n: 1 }]);

    const result = await fetchReviewsPage({ page: 1, sort: null, stars: null });

    expect(result.hasDemoData).toBe(true);
    expect(result.isProduction).toBe(false);
  });

  it('excludes is_demo rows from the query in production (FTC 16 CFR 465)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    mockSql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: 0 }])
      .mockResolvedValueOnce([{ average: null, count: 0 }])
      .mockResolvedValueOnce([]);

    await fetchReviewsPage({ page: 1, sort: null, stars: null });

    // The first call is the reviews list query — its template strings must
    // include the is_demo=false exclusion when NODE_ENV=production.
    const firstCallStrings = mockSql.mock.calls[0][0] as unknown as string[];
    const queryText = firstCallStrings.join('');
    expect(queryText).toContain('is_demo = false');
    // hasDemoData can never be true in production regardless of row content.
  });
});
