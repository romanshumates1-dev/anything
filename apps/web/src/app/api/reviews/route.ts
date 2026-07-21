import sql from '@/app/api/utils/sql';
import { rateLimitByUser } from '@/app/api/utils/rateLimit';
import { logEvent } from '@/app/api/utils/logger';

const REVIEW_RATE_LIMIT = 3; // 3 submissions per day

/**
 * Public reviews endpoint - GET for listing, POST for submission.
 * 
 * GET: Lists approved reviews (production excludes demo data)
 * POST: Authenticated users submit reviews (stored as pending)
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const limit = 10;
  const offset = (page - 1) * limit;

  // In production, exclude demo reviews
  const demoFilter = process.env.NODE_ENV === 'production' ? 'AND is_demo = false' : '';

  try {
    const reviews = await sql`
      SELECT 
        id,
        rating,
        title,
        body,
        created_at,
        status,
        is_demo,
        verified_customer,
        u.name as user_name
      FROM reviews r
      LEFT JOIN "user" u ON r.user_id = u.id
      WHERE status = 'approved' ${sql`${demoFilter}` || sql``}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const [{ total }] = await sql`
      SELECT COUNT(*)::int as total FROM reviews WHERE status = 'approved' ${sql`${demoFilter}` || sql``}
    `;

    // Calculate aggregates
    const aggregate = await sql`
      SELECT 
        AVG(rating)::numeric(10,1) as average,
        COUNT(*)::int as count
      FROM reviews 
      WHERE status = 'approved' ${sql`${demoFilter}` || sql``}
    `;

    return Response.json({
      reviews,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      },
      aggregate: {
        average: aggregate[0]?.average || 0,
        count: aggregate[0]?.count || 0
      }
    });
  } catch (error) {
    console.error('GET /api/reviews error', error);
    return Response.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch reviews' } }, { status: 500 });
  }
}

export async function POST(request: Request) {
  // Rate limiting
  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rateCheck = await rateLimitByUser(clientIp, 'review', REVIEW_RATE_LIMIT, 86400); // 24 hours
  if (!rateCheck.allowed) {
    return Response.json(
      { error: { code: 'RATE_LIMITED', message: 'Too many submissions. Please try again later.' } },
      { status: 429 }
    );
  }

  // Authentication required (server-side enforcement)
  const session = await getSession(request);
  if (!session?.user?.id) {
    return Response.json(
      { error: { code: 'UNAUTHORIZED', message: 'Authentication required to submit reviews' } },
      { status: 401 }
    );
  }

  const body = await request.json();
  const { rating, title, body: reviewBody } = body;

  // Validation
  if (!rating || rating < 1 || rating > 5) {
    return Response.json(
      { error: { code: 'INVALID_INPUT', message: 'Rating must be between 1 and 5' } },
      { status: 400 }
    );
  }
  if (!title || typeof title !== 'string' || title.length > 200) {
    return Response.json(
      { error: { code: 'INVALID_INPUT', message: 'Title required (max 200 chars)' } },
      { status: 400 }
    );
  }
  if (!reviewBody || typeof reviewBody !== 'string' || reviewBody.length > 5000) {
    return Response.json(
      { error: { code: 'INVALID_INPUT', message: 'Review body required (max 5000 chars)' } },
      { status: 400 }
    );
  }

  // Check for existing review
  const [existing] = await sql`
    SELECT id FROM reviews WHERE user_id = ${session.user.id} AND status IN ('pending', 'approved') LIMIT 1
  `;
  if (existing) {
    return Response.json(
      { error: { code: 'CONFLICT', message: 'You have already submitted a review' } },
      { status: 409 }
    );
  }

  // Create review (pending approval)
  const id = `rev_${crypto.randomUUID().replace(/-/g, '')}`;
  await sql`
    INSERT INTO reviews (id, user_id, rating, title, body, status, verified_customer)
    VALUES (${id}, ${session.user.id}, ${rating}, ${title}, ${reviewBody}, 'pending', false)
  `;

  await logEvent('review_submitted', 'review', id, { userId: session.user.id, rating });

  return Response.json({ success: true, id }, { status: 201 });
}

async function getSession(request: Request) {
  try {
    const cookie = request.headers.get('cookie') || '';
    const headers = new Headers(request.headers);
    const response = await fetch(new URL('/api/auth/get-session', request.url).toString(), {
      headers: { cookie }
    });
    const session = await response.json();
    return session;
  } catch {
    return null;
  }
}