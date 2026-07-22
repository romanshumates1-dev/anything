import sql from '@/app/api/utils/sql';
import { rateLimitByUser } from '@/app/api/utils/rateLimit';
import { logEvent } from '@/app/api/utils/logger';
import { fetchReviewsPage } from './queries';

const REVIEW_RATE_LIMIT = 3; // 3 submissions per day

/**
 * Public reviews endpoint - GET for listing, POST for submission.
 *
 * GET: Lists approved reviews. In production, is_demo rows are excluded from
 * both the list and the aggregates (FTC 16 CFR 465 — fabricated reviews must
 * never be presentable as genuine). Supports ?sort=newest|oldest|highest|lowest,
 * ?stars=1-5 (filter), ?page=. Query logic lives in ./queries.ts, shared with
 * the /reviews server component's initial SSR fetch (bug #27 fix — see that
 * file for why is_demo/sort can't just be interpolated into the sql tag).
 * POST: Authenticated, purchase-verified users submit reviews (stored as pending).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const result = await fetchReviewsPage({
      page: parseInt(url.searchParams.get('page') || '1', 10),
      sort: url.searchParams.get('sort'),
      stars: url.searchParams.get('stars'),
    });
    return Response.json(result);
  } catch (error) {
    console.error('GET /api/reviews error', error);
    return Response.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch reviews' } }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    // Authentication is checked BEFORE the rate limit is consumed — the prior
    // order let an anonymous caller burn the daily submission budget for
    // whoever shares its IP/NAT.
    const session = await getSession(request);
    if (!session?.user?.id) {
      return Response.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required to submit reviews' } },
        { status: 401 }
      );
    }

    // Rate limit keyed by the actual account, not a spoofable client IP.
    const rateCheck = await rateLimitByUser(session.user.id, 'review', REVIEW_RATE_LIMIT, 86400); // 24 hours
    if (!rateCheck.allowed) {
      return Response.json(
        { error: { code: 'RATE_LIMITED', message: 'Too many submissions. Please try again later.' } },
        { status: 429 }
      );
    }

    const body = await request.json().catch(() => ({}));
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

    // Purchase/subscription verification (Prompt 1 Phase 2 hard requirement):
    // "customer" = a member of an organization that has ever held a paid
    // subscription state. 'trial' does NOT count — our own pricing page
    // advertises "30-day free trial, no credit card required", so a trial
    // alone is not a completed purchase.
    const [customerRow] = await sql`
      SELECT 1 FROM organization_members om
      JOIN organization_subscriptions os ON os.organization_id = om.organization_id
      WHERE om.user_id = ${session.user.id}
        AND os.status IN ('active', 'past_due', 'canceled')
      LIMIT 1
    `;
    if (!customerRow) {
      return Response.json(
        {
          error: {
            code: 'NOT_A_CUSTOMER',
            message: 'Only customers with an active or past subscription can submit a review.',
          },
        },
        { status: 403 }
      );
    }

    // Existing-review handling: one row per user (uniq_reviews_user, migration
    // 033/#25). A prior 'pending'/'approved' review blocks resubmission with a
    // friendly 409; a prior 'rejected' review is allowed to be resubmitted by
    // UPDATING the existing row (the unique index forbids a second INSERT
    // regardless of status, so a plain INSERT would 500 here otherwise).
    const [existing] = await sql`
      SELECT id, status FROM reviews WHERE user_id = ${session.user.id} LIMIT 1
    `;
    if (existing && existing.status !== 'rejected') {
      return Response.json(
        { error: { code: 'CONFLICT', message: 'You have already submitted a review' } },
        { status: 409 }
      );
    }

    let id: string;
    if (existing) {
      id = existing.id;
      await sql`
        UPDATE reviews
        SET rating = ${rating}, title = ${title}, body = ${reviewBody},
            status = 'pending', verified_customer = true, admin_note = NULL, updated_at = now()
        WHERE id = ${id}
      `;
    } else {
      id = `rev_${crypto.randomUUID().replace(/-/g, '')}`;
      await sql`
        INSERT INTO reviews (id, user_id, rating, title, body, status, verified_customer)
        VALUES (${id}, ${session.user.id}, ${rating}, ${title}, ${reviewBody}, 'pending', true)
      `;
    }

    await logEvent('review_submitted', 'review', id, { rating }, session.user.id);

    return Response.json({ success: true, id }, { status: 201 });
  } catch (error) {
    console.error('POST /api/reviews error', error);
    return Response.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to submit review' } }, { status: 500 });
  }
}

async function getSession(request: Request) {
  try {
    const cookie = request.headers.get('cookie') || '';
    const response = await fetch(new URL('/api/auth/get-session', request.url).toString(), {
      headers: { cookie }
    });
    const session = await response.json();
    return session;
  } catch {
    return null;
  }
}