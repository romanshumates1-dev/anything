import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { logEvent } from '../utils/logger';

const VALID_CATEGORIES = ['BUG', 'FEATURE', 'GENERAL', 'PRAISE'] as const;
const VALID_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
const VALID_STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'PLANNED', 'IN_PROGRESS', 'COMPLETED', 'DECLINED'] as const;

type Category = (typeof VALID_CATEGORIES)[number];
type Priority = (typeof VALID_PRIORITIES)[number];
type Status = (typeof VALID_STATUSES)[number];

/**
 * GET /api/feedback
 * Returns feedback items. Public items visible to all, private items visible to submitter and admins.
 * Query params:
 *   - category: filter by category
 *   - status: filter by status
 *   - mine: if 'true', only show user's own feedback
 *   - sort: 'votes' | 'newest' | 'oldest' (default: votes)
 *   - limit: max items to return (default: 50, max: 100)
 *   - offset: pagination offset
 */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id || null;
  const userRole = (session?.user as { role?: string })?.role;
  const isAdmin = userRole === 'ADMIN';

  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category') as Category | null;
  const status = searchParams.get('status') as Status | null;
  const mine = searchParams.get('mine') === 'true';
  const sort = searchParams.get('sort') || 'votes';
  const limitParam = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
  const offsetParam = parseInt(searchParams.get('offset') || '0');

  try {
    // Use multiple simpler queries based on filter combinations
    // This avoids complex dynamic SQL while still supporting the needed filters

    let feedbackItems: any[];

    // Build query based on access level and filters
    if (isAdmin) {
      // Admins see everything
      if (mine && userId) {
        if (category && VALID_CATEGORIES.includes(category)) {
          if (status && VALID_STATUSES.includes(status)) {
            feedbackItems = await sql`
              SELECT f.*, u.name AS author_name,
                EXISTS(SELECT 1 FROM feedback_votes fv WHERE fv.feedback_id = f.id AND fv.user_id = ${userId}) AS user_voted,
                (SELECT COUNT(*)::int FROM feedback_responses fr WHERE fr.feedback_id = f.id AND fr.is_public = true) AS response_count
              FROM feedback f
              LEFT JOIN "user" u ON f.user_id = u.id
              WHERE f.user_id = ${userId} AND f.category = ${category} AND f.status = ${status}
              ORDER BY ${sort === 'newest' ? sql`f.created_at DESC` : sort === 'oldest' ? sql`f.created_at ASC` : sql`f.vote_count DESC, f.created_at DESC`}
              LIMIT ${limitParam} OFFSET ${offsetParam}
            `;
          } else {
            feedbackItems = await sql`
              SELECT f.*, u.name AS author_name,
                EXISTS(SELECT 1 FROM feedback_votes fv WHERE fv.feedback_id = f.id AND fv.user_id = ${userId}) AS user_voted,
                (SELECT COUNT(*)::int FROM feedback_responses fr WHERE fr.feedback_id = f.id AND fr.is_public = true) AS response_count
              FROM feedback f
              LEFT JOIN "user" u ON f.user_id = u.id
              WHERE f.user_id = ${userId} AND f.category = ${category}
              ORDER BY ${sort === 'newest' ? sql`f.created_at DESC` : sort === 'oldest' ? sql`f.created_at ASC` : sql`f.vote_count DESC, f.created_at DESC`}
              LIMIT ${limitParam} OFFSET ${offsetParam}
            `;
          }
        } else if (status && VALID_STATUSES.includes(status)) {
          feedbackItems = await sql`
            SELECT f.*, u.name AS author_name,
              EXISTS(SELECT 1 FROM feedback_votes fv WHERE fv.feedback_id = f.id AND fv.user_id = ${userId}) AS user_voted,
              (SELECT COUNT(*)::int FROM feedback_responses fr WHERE fr.feedback_id = f.id AND fr.is_public = true) AS response_count
            FROM feedback f
            LEFT JOIN "user" u ON f.user_id = u.id
            WHERE f.user_id = ${userId} AND f.status = ${status}
            ORDER BY ${sort === 'newest' ? sql`f.created_at DESC` : sort === 'oldest' ? sql`f.created_at ASC` : sql`f.vote_count DESC, f.created_at DESC`}
            LIMIT ${limitParam} OFFSET ${offsetParam}
          `;
        } else {
          feedbackItems = await sql`
            SELECT f.*, u.name AS author_name,
              EXISTS(SELECT 1 FROM feedback_votes fv WHERE fv.feedback_id = f.id AND fv.user_id = ${userId}) AS user_voted,
              (SELECT COUNT(*)::int FROM feedback_responses fr WHERE fr.feedback_id = f.id AND fr.is_public = true) AS response_count
            FROM feedback f
            LEFT JOIN "user" u ON f.user_id = u.id
            WHERE f.user_id = ${userId}
            ORDER BY ${sort === 'newest' ? sql`f.created_at DESC` : sort === 'oldest' ? sql`f.created_at ASC` : sql`f.vote_count DESC, f.created_at DESC`}
            LIMIT ${limitParam} OFFSET ${offsetParam}
          `;
        }
      } else if (category && VALID_CATEGORIES.includes(category)) {
        if (status && VALID_STATUSES.includes(status)) {
          feedbackItems = await sql`
            SELECT f.*,
              CASE WHEN f.is_anonymous THEN NULL ELSE u.name END AS author_name,
              CASE WHEN f.is_anonymous THEN NULL ELSE f.user_id END AS author_id,
              ${userId ? sql`EXISTS(SELECT 1 FROM feedback_votes fv WHERE fv.feedback_id = f.id AND fv.user_id = ${userId})` : sql`false`} AS user_voted,
              (SELECT COUNT(*)::int FROM feedback_responses fr WHERE fr.feedback_id = f.id AND fr.is_public = true) AS response_count
            FROM feedback f
            LEFT JOIN "user" u ON f.user_id = u.id
            WHERE f.category = ${category} AND f.status = ${status}
            ORDER BY ${sort === 'newest' ? sql`f.created_at DESC` : sort === 'oldest' ? sql`f.created_at ASC` : sql`f.vote_count DESC, f.created_at DESC`}
            LIMIT ${limitParam} OFFSET ${offsetParam}
          `;
        } else {
          feedbackItems = await sql`
            SELECT f.*,
              CASE WHEN f.is_anonymous THEN NULL ELSE u.name END AS author_name,
              CASE WHEN f.is_anonymous THEN NULL ELSE f.user_id END AS author_id,
              ${userId ? sql`EXISTS(SELECT 1 FROM feedback_votes fv WHERE fv.feedback_id = f.id AND fv.user_id = ${userId})` : sql`false`} AS user_voted,
              (SELECT COUNT(*)::int FROM feedback_responses fr WHERE fr.feedback_id = f.id AND fr.is_public = true) AS response_count
            FROM feedback f
            LEFT JOIN "user" u ON f.user_id = u.id
            WHERE f.category = ${category}
            ORDER BY ${sort === 'newest' ? sql`f.created_at DESC` : sort === 'oldest' ? sql`f.created_at ASC` : sql`f.vote_count DESC, f.created_at DESC`}
            LIMIT ${limitParam} OFFSET ${offsetParam}
          `;
        }
      } else if (status && VALID_STATUSES.includes(status)) {
        feedbackItems = await sql`
          SELECT f.*,
            CASE WHEN f.is_anonymous THEN NULL ELSE u.name END AS author_name,
            CASE WHEN f.is_anonymous THEN NULL ELSE f.user_id END AS author_id,
            ${userId ? sql`EXISTS(SELECT 1 FROM feedback_votes fv WHERE fv.feedback_id = f.id AND fv.user_id = ${userId})` : sql`false`} AS user_voted,
            (SELECT COUNT(*)::int FROM feedback_responses fr WHERE fr.feedback_id = f.id AND fr.is_public = true) AS response_count
          FROM feedback f
          LEFT JOIN "user" u ON f.user_id = u.id
          WHERE f.status = ${status}
          ORDER BY ${sort === 'newest' ? sql`f.created_at DESC` : sort === 'oldest' ? sql`f.created_at ASC` : sql`f.vote_count DESC, f.created_at DESC`}
          LIMIT ${limitParam} OFFSET ${offsetParam}
        `;
      } else {
        feedbackItems = await sql`
          SELECT f.*,
            CASE WHEN f.is_anonymous THEN NULL ELSE u.name END AS author_name,
            CASE WHEN f.is_anonymous THEN NULL ELSE f.user_id END AS author_id,
            ${userId ? sql`EXISTS(SELECT 1 FROM feedback_votes fv WHERE fv.feedback_id = f.id AND fv.user_id = ${userId})` : sql`false`} AS user_voted,
            (SELECT COUNT(*)::int FROM feedback_responses fr WHERE fr.feedback_id = f.id AND fr.is_public = true) AS response_count
          FROM feedback f
          LEFT JOIN "user" u ON f.user_id = u.id
          ORDER BY ${sort === 'newest' ? sql`f.created_at DESC` : sort === 'oldest' ? sql`f.created_at ASC` : sql`f.vote_count DESC, f.created_at DESC`}
          LIMIT ${limitParam} OFFSET ${offsetParam}
        `;
      }
    } else {
      // Non-admins: see public items + their own, exclude DECLINED unless own
      if (userId) {
        if (category && VALID_CATEGORIES.includes(category)) {
          if (status && VALID_STATUSES.includes(status)) {
            feedbackItems = await sql`
              SELECT f.*,
                CASE WHEN f.is_anonymous THEN NULL ELSE u.name END AS author_name,
                CASE WHEN f.is_anonymous THEN NULL ELSE f.user_id END AS author_id,
                EXISTS(SELECT 1 FROM feedback_votes fv WHERE fv.feedback_id = f.id AND fv.user_id = ${userId}) AS user_voted,
                (SELECT COUNT(*)::int FROM feedback_responses fr WHERE fr.feedback_id = f.id AND fr.is_public = true) AS response_count
              FROM feedback f
              LEFT JOIN "user" u ON f.user_id = u.id
              WHERE (f.is_public = true OR f.user_id = ${userId})
                AND f.category = ${category}
                AND f.status = ${status}
                AND (f.status != 'DECLINED' OR f.user_id = ${userId})
              ORDER BY ${sort === 'newest' ? sql`f.created_at DESC` : sort === 'oldest' ? sql`f.created_at ASC` : sql`f.vote_count DESC, f.created_at DESC`}
              LIMIT ${limitParam} OFFSET ${offsetParam}
            `;
          } else {
            feedbackItems = await sql`
              SELECT f.*,
                CASE WHEN f.is_anonymous THEN NULL ELSE u.name END AS author_name,
                CASE WHEN f.is_anonymous THEN NULL ELSE f.user_id END AS author_id,
                EXISTS(SELECT 1 FROM feedback_votes fv WHERE fv.feedback_id = f.id AND fv.user_id = ${userId}) AS user_voted,
                (SELECT COUNT(*)::int FROM feedback_responses fr WHERE fr.feedback_id = f.id AND fr.is_public = true) AS response_count
              FROM feedback f
              LEFT JOIN "user" u ON f.user_id = u.id
              WHERE (f.is_public = true OR f.user_id = ${userId})
                AND f.category = ${category}
                AND (f.status != 'DECLINED' OR f.user_id = ${userId})
              ORDER BY ${sort === 'newest' ? sql`f.created_at DESC` : sort === 'oldest' ? sql`f.created_at ASC` : sql`f.vote_count DESC, f.created_at DESC`}
              LIMIT ${limitParam} OFFSET ${offsetParam}
            `;
          }
        } else if (status && VALID_STATUSES.includes(status)) {
          feedbackItems = await sql`
            SELECT f.*,
              CASE WHEN f.is_anonymous THEN NULL ELSE u.name END AS author_name,
              CASE WHEN f.is_anonymous THEN NULL ELSE f.user_id END AS author_id,
              EXISTS(SELECT 1 FROM feedback_votes fv WHERE fv.feedback_id = f.id AND fv.user_id = ${userId}) AS user_voted,
              (SELECT COUNT(*)::int FROM feedback_responses fr WHERE fr.feedback_id = f.id AND fr.is_public = true) AS response_count
            FROM feedback f
            LEFT JOIN "user" u ON f.user_id = u.id
            WHERE (f.is_public = true OR f.user_id = ${userId})
              AND f.status = ${status}
              AND (f.status != 'DECLINED' OR f.user_id = ${userId})
            ORDER BY ${sort === 'newest' ? sql`f.created_at DESC` : sort === 'oldest' ? sql`f.created_at ASC` : sql`f.vote_count DESC, f.created_at DESC`}
            LIMIT ${limitParam} OFFSET ${offsetParam}
          `;
        } else {
          feedbackItems = await sql`
            SELECT f.*,
              CASE WHEN f.is_anonymous THEN NULL ELSE u.name END AS author_name,
              CASE WHEN f.is_anonymous THEN NULL ELSE f.user_id END AS author_id,
              EXISTS(SELECT 1 FROM feedback_votes fv WHERE fv.feedback_id = f.id AND fv.user_id = ${userId}) AS user_voted,
              (SELECT COUNT(*)::int FROM feedback_responses fr WHERE fr.feedback_id = f.id AND fr.is_public = true) AS response_count
            FROM feedback f
            LEFT JOIN "user" u ON f.user_id = u.id
            WHERE (f.is_public = true OR f.user_id = ${userId})
              AND (f.status != 'DECLINED' OR f.user_id = ${userId})
            ORDER BY ${sort === 'newest' ? sql`f.created_at DESC` : sort === 'oldest' ? sql`f.created_at ASC` : sql`f.vote_count DESC, f.created_at DESC`}
            LIMIT ${limitParam} OFFSET ${offsetParam}
          `;
        }
      } else {
        // Anonymous users: only public, non-declined
        if (category && VALID_CATEGORIES.includes(category)) {
          if (status && VALID_STATUSES.includes(status)) {
            feedbackItems = await sql`
              SELECT f.*,
                CASE WHEN f.is_anonymous THEN NULL ELSE u.name END AS author_name,
                CASE WHEN f.is_anonymous THEN NULL ELSE f.user_id END AS author_id,
                false AS user_voted,
                (SELECT COUNT(*)::int FROM feedback_responses fr WHERE fr.feedback_id = f.id AND fr.is_public = true) AS response_count
              FROM feedback f
              LEFT JOIN "user" u ON f.user_id = u.id
              WHERE f.is_public = true
                AND f.category = ${category}
                AND f.status = ${status}
                AND f.status != 'DECLINED'
              ORDER BY ${sort === 'newest' ? sql`f.created_at DESC` : sort === 'oldest' ? sql`f.created_at ASC` : sql`f.vote_count DESC, f.created_at DESC`}
              LIMIT ${limitParam} OFFSET ${offsetParam}
            `;
          } else {
            feedbackItems = await sql`
              SELECT f.*,
                CASE WHEN f.is_anonymous THEN NULL ELSE u.name END AS author_name,
                CASE WHEN f.is_anonymous THEN NULL ELSE f.user_id END AS author_id,
                false AS user_voted,
                (SELECT COUNT(*)::int FROM feedback_responses fr WHERE fr.feedback_id = f.id AND fr.is_public = true) AS response_count
              FROM feedback f
              LEFT JOIN "user" u ON f.user_id = u.id
              WHERE f.is_public = true
                AND f.category = ${category}
                AND f.status != 'DECLINED'
              ORDER BY ${sort === 'newest' ? sql`f.created_at DESC` : sort === 'oldest' ? sql`f.created_at ASC` : sql`f.vote_count DESC, f.created_at DESC`}
              LIMIT ${limitParam} OFFSET ${offsetParam}
            `;
          }
        } else if (status && VALID_STATUSES.includes(status)) {
          feedbackItems = await sql`
            SELECT f.*,
              CASE WHEN f.is_anonymous THEN NULL ELSE u.name END AS author_name,
              CASE WHEN f.is_anonymous THEN NULL ELSE f.user_id END AS author_id,
              false AS user_voted,
              (SELECT COUNT(*)::int FROM feedback_responses fr WHERE fr.feedback_id = f.id AND fr.is_public = true) AS response_count
            FROM feedback f
            LEFT JOIN "user" u ON f.user_id = u.id
            WHERE f.is_public = true
              AND f.status = ${status}
              AND f.status != 'DECLINED'
            ORDER BY ${sort === 'newest' ? sql`f.created_at DESC` : sort === 'oldest' ? sql`f.created_at ASC` : sql`f.vote_count DESC, f.created_at DESC`}
            LIMIT ${limitParam} OFFSET ${offsetParam}
          `;
        } else {
          feedbackItems = await sql`
            SELECT f.*,
              CASE WHEN f.is_anonymous THEN NULL ELSE u.name END AS author_name,
              CASE WHEN f.is_anonymous THEN NULL ELSE f.user_id END AS author_id,
              false AS user_voted,
              (SELECT COUNT(*)::int FROM feedback_responses fr WHERE fr.feedback_id = f.id AND fr.is_public = true) AS response_count
            FROM feedback f
            LEFT JOIN "user" u ON f.user_id = u.id
            WHERE f.is_public = true
              AND f.status != 'DECLINED'
            ORDER BY ${sort === 'newest' ? sql`f.created_at DESC` : sort === 'oldest' ? sql`f.created_at ASC` : sql`f.vote_count DESC, f.created_at DESC`}
            LIMIT ${limitParam} OFFSET ${offsetParam}
          `;
        }
      }
    }

    // Get total count (simplified - just count matching items)
    const [{ total }] = await sql`SELECT COUNT(*)::int as total FROM feedback`;

    return Response.json({
      items: feedbackItems,
      total,
      limit: limitParam,
      offset: offsetParam,
    });
  } catch (error: any) {
    console.error('GET /api/feedback error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * POST /api/feedback
 * Submit new feedback. Requires authentication.
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      category = 'GENERAL',
      title,
      description,
      screenshot_url,
      priority = 'MEDIUM',
      is_public = true,
      is_anonymous = false,
    } = body;

    // Validate required fields
    if (!title || typeof title !== 'string' || title.trim().length < 3) {
      return Response.json({ error: 'Title is required (min 3 characters)' }, { status: 400 });
    }
    if (!description || typeof description !== 'string' || description.trim().length < 10) {
      return Response.json({ error: 'Description is required (min 10 characters)' }, { status: 400 });
    }

    // Validate enums
    if (!VALID_CATEGORIES.includes(category)) {
      return Response.json({ error: 'Invalid category' }, { status: 400 });
    }
    if (!VALID_PRIORITIES.includes(priority)) {
      return Response.json({ error: 'Invalid priority' }, { status: 400 });
    }

    const userId = session.user.id;
    const orgId = session.user.id; // Using user ID as org ID for now

    const [feedback] = await sql`
      INSERT INTO feedback (
        user_id,
        organization_id,
        category,
        title,
        description,
        screenshot_url,
        priority,
        is_public,
        is_anonymous
      )
      VALUES (
        ${userId},
        ${orgId},
        ${category},
        ${title.trim()},
        ${description.trim()},
        ${screenshot_url || null},
        ${priority},
        ${is_public},
        ${is_anonymous}
      )
      RETURNING *
    `;

    await logEvent('feedback_submitted', 'feedback', feedback.id, {
      category,
      title: title.trim(),
      is_public,
      is_anonymous,
    }, userId);

    return Response.json(feedback, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/feedback error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
