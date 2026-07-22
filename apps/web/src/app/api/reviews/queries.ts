import sql from '@/app/api/utils/sql';

/**
 * Shared reviews-read logic — used by both GET /api/reviews (client refetch
 * on sort/filter/page change) and the /reviews server component (initial
 * SSR fetch, so schema.org structured data is present in the crawlable HTML).
 * One implementation, so the two callers can never drift apart.
 *
 * neon@0.10.4 has no composable-fragment API — is_demo exclusion branches
 * into two literal query strings rather than composing a WHERE fragment (see
 * BREAKAGE_TABLE.md bug #27); sort uses a CASE expression with sortKey bound
 * as an ordinary parameter, since column/direction can't be parameterized
 * directly in SQL.
 */

export type SortKey = 'newest' | 'oldest' | 'highest' | 'lowest';
const VALID_SORTS: SortKey[] = ['newest', 'oldest', 'highest', 'lowest'];

export function normalizeSort(raw: string | null): SortKey {
  return (VALID_SORTS as string[]).includes(raw || '') ? (raw as SortKey) : 'newest';
}

export function normalizeStars(raw: string | null): number | null {
  const n = parseInt(raw || '', 10);
  return n >= 1 && n <= 5 ? n : null;
}

export async function fetchReviewsList(opts: {
  excludeDemo: boolean;
  sortKey: SortKey;
  starsFilter: number | null;
  limit: number;
  offset: number;
}) {
  const { excludeDemo, sortKey, starsFilter, limit, offset } = opts;
  return excludeDemo
    ? sql`
        SELECT r.id, r.rating, r.title, r.body, r.created_at, r.is_demo, r.verified_customer, COALESCE(u.name, r.demo_display_name) AS user_name
        FROM reviews r LEFT JOIN "user" u ON r.user_id = u.id
        WHERE r.status = 'approved' AND r.is_demo = false
          AND (${starsFilter}::int IS NULL OR r.rating = ${starsFilter})
        ORDER BY
          CASE WHEN ${sortKey} = 'highest' THEN r.rating END DESC NULLS LAST,
          CASE WHEN ${sortKey} = 'lowest' THEN r.rating END ASC NULLS LAST,
          CASE WHEN ${sortKey} = 'oldest' THEN r.created_at END ASC NULLS LAST,
          r.created_at DESC
        LIMIT ${limit} OFFSET ${offset}`
    : sql`
        SELECT r.id, r.rating, r.title, r.body, r.created_at, r.is_demo, r.verified_customer, COALESCE(u.name, r.demo_display_name) AS user_name
        FROM reviews r LEFT JOIN "user" u ON r.user_id = u.id
        WHERE r.status = 'approved'
          AND (${starsFilter}::int IS NULL OR r.rating = ${starsFilter})
        ORDER BY
          CASE WHEN ${sortKey} = 'highest' THEN r.rating END DESC NULLS LAST,
          CASE WHEN ${sortKey} = 'lowest' THEN r.rating END ASC NULLS LAST,
          CASE WHEN ${sortKey} = 'oldest' THEN r.created_at END ASC NULLS LAST,
          r.created_at DESC
        LIMIT ${limit} OFFSET ${offset}`;
}

export async function fetchReviewsSummary(opts: { excludeDemo: boolean; starsFilter: number | null }) {
  const { excludeDemo, starsFilter } = opts;

  const [{ total }] = excludeDemo
    ? await sql`SELECT COUNT(*)::int AS total FROM reviews WHERE status = 'approved' AND is_demo = false AND (${starsFilter}::int IS NULL OR rating = ${starsFilter})`
    : await sql`SELECT COUNT(*)::int AS total FROM reviews WHERE status = 'approved' AND (${starsFilter}::int IS NULL OR rating = ${starsFilter})`;

  // Aggregate + distribution ignore starsFilter (they describe the whole
  // review population regardless of the current filter view).
  const [aggRow] = excludeDemo
    ? await sql`SELECT AVG(rating)::numeric(10,1) AS average, COUNT(*)::int AS count FROM reviews WHERE status = 'approved' AND is_demo = false`
    : await sql`SELECT AVG(rating)::numeric(10,1) AS average, COUNT(*)::int AS count FROM reviews WHERE status = 'approved'`;
  const distRows = excludeDemo
    ? await sql`SELECT rating, COUNT(*)::int AS n FROM reviews WHERE status = 'approved' AND is_demo = false GROUP BY rating`
    : await sql`SELECT rating, COUNT(*)::int AS n FROM reviews WHERE status = 'approved' GROUP BY rating`;

  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of distRows as any[]) distribution[r.rating] = r.n;

  return {
    total,
    aggregate: { average: Number(aggRow?.average) || 0, count: aggRow?.count || 0, distribution },
  };
}

export type Review = {
  id: string;
  rating: number;
  title: string;
  body: string;
  created_at: string;
  is_demo: boolean;
  verified_customer: boolean;
  user_name: string | null;
};

export type ReviewsPageResult = {
  reviews: Review[];
  pagination: { page: number; limit: number; total: number; pages: number };
  aggregate: { average: number; count: number; distribution: Record<number, number> };
  hasDemoData: boolean;
  isProduction: boolean;
};

export async function fetchReviewsPage(opts: {
  page: number;
  sort: string | null;
  stars: string | null;
}): Promise<ReviewsPageResult> {
  const excludeDemo = process.env.NODE_ENV === 'production';
  const sortKey = normalizeSort(opts.sort);
  const starsFilter = normalizeStars(opts.stars);
  const limit = 10;
  const page = Math.max(1, opts.page || 1);
  const offset = (page - 1) * limit;

  const reviews = (await fetchReviewsList({ excludeDemo, sortKey, starsFilter, limit, offset })) as unknown as Review[];
  const { total, aggregate } = await fetchReviewsSummary({ excludeDemo, starsFilter });
  const hasDemoData = !excludeDemo && reviews.some((r) => r.is_demo);

  return {
    reviews,
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    aggregate,
    hasDemoData,
    isProduction: excludeDemo,
  };
}
