import sql from '@/app/api/utils/sql';
import { buildWhere } from '@/app/api/utils/sqlFragments';
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

  // Defect #32 (second wave): the sort was previously chosen by interpolating a
  // `sql` fragment, `ORDER BY ${sort === 'newest' ? sql`f.created_at DESC` :
  // ...}`. This driver sends that as a positional PARAMETER, and because
  // `ORDER BY $n` is syntactically valid, the query RAN - with the ordering
  // silently wrong (no error, wrong results). The direction/column now come
  // from a validated allowlist.
  const orderByClause =
    sort === 'newest'
      ? 'f.created_at DESC'
      : sort === 'oldest'
        ? 'f.created_at ASC'
        : 'f.vote_count DESC, f.created_at DESC';

  try {
    // Use multiple simpler queries based on filter combinations
    // This avoids complex dynamic SQL while still supporting the needed filters

    // ONE query instead of the previous nine near-identical blocks.
    //
    // Two defects are fixed together here:
    //  1. Every block ended with `ORDER BY ${orderByClause}`. orderByClause is a
    //     STRING, and this driver binds every interpolation to a positional $n -
    //     so it became `ORDER BY $9` and the endpoint answered 500 for everyone.
    //     (A fragment in ORDER BY is worse still: it runs and sorts wrongly.)
    //  2. Nine copies of the same access-control rules is nine places for the
    //     rules to drift. The rules now exist once, below.
    //
    // Access rules, preserved exactly:
    //   admin                     -> everything
    //   member                    -> public OR own, minus DECLINED unless own
    //   anonymous                 -> public, minus DECLINED
    const scope = buildWhere();

    if (isAdmin) {
      if (mine && userId) scope.eq('f.user_id', userId);
    } else if (userId) {
      scope.raw('(f.is_public = true OR f.user_id = $1)', userId);
      scope.raw('(f.status != \'DECLINED\' OR f.user_id = $1)', userId);
    } else {
      scope.raw('f.is_public = true').raw("f.status != 'DECLINED'");
    }
    // An invalid enum value must be a 400, not a Postgres 500.
    if (category) {
      if (!VALID_CATEGORIES.includes(category)) {
        return Response.json(
          { error: `Invalid category. Expected one of: ${VALID_CATEGORIES.join(', ')}` },
          { status: 400 }
        );
      }
      scope.eq('f.category', category);
    }
    if (status) {
      if (!VALID_STATUSES.includes(status)) {
        return Response.json(
          { error: `Invalid status. Expected one of: ${VALID_STATUSES.join(', ')}` },
          { status: 400 }
        );
      }
      scope.eq('f.status', status);
    }

    const where = scope.build();
    // `mine` is only meaningful for a signed-in member; an admin asking for
    // "mine" is the same as asking for their own rows, which scope.eq covers.
    if (mine && !userId) {
      return Response.json({ items: [], total: 0, limit: limitParam, offset: offsetParam });
    }

    const votedColumn = userId
      ? `EXISTS(SELECT 1 FROM feedback_votes fv WHERE fv.feedback_id = f.id AND fv.user_id = $${where.params.length + 1})`
      : 'false';
    const authorColumns = isAdmin
      ? 'f.user_id AS author_id,'
      : "CASE WHEN f.is_anonymous THEN NULL ELSE NULL END AS author_id,";

    const voteParam = userId ? [userId] : [];
    const rows = await sql(
      `SELECT f.*, ${authorColumns}
              u.name AS author_name,
              ${votedColumn} AS user_voted,
              (SELECT COUNT(*)::int FROM feedback_responses fr WHERE fr.feedback_id = f.id AND fr.is_public = true) AS response_count
       FROM feedback f
       LEFT JOIN "user" u ON f.user_id = u.id
       WHERE ${where.text}
       ORDER BY ${orderByClause}
       LIMIT $${where.params.length + 1 + voteParam.length} OFFSET $${where.params.length + 2 + voteParam.length}`,
      [...where.params, ...voteParam, limitParam, offsetParam] as never[]
    );

    const feedbackItems: any[] = rows;

    // Build query based on access level and filters

    // Get total count (simplified - just count matching items)
    const [{ total }] = await sql`SELECT COUNT(*)::int as total FROM feedback`;

    // PRIVACY (defect #36). This endpoint's session is OPTIONAL: an anonymous
    // caller gets a 200 and the same rows an admin gets. `SELECT f.*` therefore
    // published `f.user_id` - and the `author_id` alias, which is the same value
    // - for every non-anonymous submission, to anyone on the internet. Internal
    // user ids are stable join keys across endpoints, so this is a real
    // identifier leak, not cosmetic. Admins keep them (they moderate feedback);
    // everyone else gets the row without the raw ids.
    const visibleItems = isAdmin
      ? feedbackItems
      : feedbackItems.map((row: Record<string, unknown>) => {
          const { user_id, author_id, ...rest } = row;
          void user_id;
          void author_id;
          return rest;
        });

    return Response.json({
      items: visibleItems,
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
