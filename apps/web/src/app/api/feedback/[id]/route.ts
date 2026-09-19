import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { logEvent } from '../../utils/logger';

const VALID_STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'PLANNED', 'IN_PROGRESS', 'COMPLETED', 'DECLINED'] as const;
type Status = (typeof VALID_STATUSES)[number];

/**
 * GET /api/feedback/[id]
 * Get a single feedback item with responses.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;
  const userRole = (session?.user as { role?: string })?.role;
  const isAdmin = userRole === 'ADMIN';

  try {
    // Fetch feedback
    const [feedback] = await sql`
      SELECT
        f.*,
        CASE
          WHEN f.is_anonymous THEN NULL
          ELSE u.name
        END AS author_name,
        CASE
          WHEN f.is_anonymous THEN NULL
          ELSE f.user_id
        END AS author_id
      FROM feedback f
      LEFT JOIN "user" u ON f.user_id = u.id
      WHERE f.id = ${id}
    `;

    if (!feedback) {
      return Response.json({ error: 'Feedback not found' }, { status: 404 });
    }

    // Check visibility
    const canView = isAdmin ||
      feedback.is_public ||
      feedback.user_id === userId;

    if (!canView) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }

    // Fetch public responses (or all for admins)
    const responses = isAdmin
      ? await sql`
          SELECT
            fr.id,
            fr.response,
            fr.is_public,
            fr.created_at,
            fr.updated_at,
            u.name AS admin_name
          FROM feedback_responses fr
          LEFT JOIN "user" u ON fr.admin_id = u.id
          WHERE fr.feedback_id = ${id}
          ORDER BY fr.created_at ASC
        `
      : await sql`
          SELECT
            fr.id,
            fr.response,
            fr.is_public,
            fr.created_at,
            fr.updated_at,
            u.name AS admin_name
          FROM feedback_responses fr
          LEFT JOIN "user" u ON fr.admin_id = u.id
          WHERE fr.feedback_id = ${id} AND fr.is_public = true
          ORDER BY fr.created_at ASC
        `;

    // Check if user has voted
    let userVoted = false;
    if (userId) {
      const [vote] = await sql`
        SELECT 1 FROM feedback_votes WHERE feedback_id = ${id} AND user_id = ${userId}
      `;
      userVoted = !!vote;
    }

    return Response.json({
      ...feedback,
      responses,
      user_voted: userVoted,
    });
  } catch (error: any) {
    console.error(`GET /api/feedback/${id} error`, error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * PATCH /api/feedback/[id]
 * Update feedback. Users can edit their own (limited fields). Admins can update status and more.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;
  const userRole = (session?.user as { role?: string })?.role;
  const isAdmin = userRole === 'ADMIN';

  try {
    // Fetch existing feedback
    const [existing] = await sql`
      SELECT * FROM feedback WHERE id = ${id}
    `;

    if (!existing) {
      return Response.json({ error: 'Feedback not found' }, { status: 404 });
    }

    const body = await request.json();
    const isOwner = existing.user_id === userId;

    // Non-admin, non-owner cannot edit
    if (!isAdmin && !isOwner) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Determine what to update based on permissions and input
    const now = new Date().toISOString();

    // Admin status update
    if (isAdmin && body.status !== undefined && VALID_STATUSES.includes(body.status as Status)) {
      const newStatus = body.status as Status;
      const completedAt = newStatus === 'COMPLETED' ? now : null;

      await sql`
        UPDATE feedback
        SET
          status = ${newStatus},
          status_changed_at = ${now},
          completed_at = ${completedAt},
          updated_at = ${now}
        WHERE id = ${id}
      `;

      await logEvent('feedback_status_changed', 'feedback', id, {
        from: existing.status,
        to: newStatus,
      }, userId);
    }

    // Admin notes update
    if (isAdmin && body.admin_notes !== undefined) {
      await sql`
        UPDATE feedback
        SET admin_notes = ${body.admin_notes}, updated_at = ${now}
        WHERE id = ${id}
      `;
    }

    // Admin duplicate marking
    if (isAdmin && body.duplicate_of_id !== undefined) {
      await sql`
        UPDATE feedback
        SET duplicate_of_id = ${body.duplicate_of_id || null}, updated_at = ${now}
        WHERE id = ${id}
      `;
    }

    // Owner can update content fields if status is SUBMITTED
    if (isOwner && existing.status === 'SUBMITTED') {
      if (body.title !== undefined) {
        await sql`
          UPDATE feedback
          SET title = ${body.title.trim()}, updated_at = ${now}
          WHERE id = ${id}
        `;
      }
      if (body.description !== undefined) {
        await sql`
          UPDATE feedback
          SET description = ${body.description.trim()}, updated_at = ${now}
          WHERE id = ${id}
        `;
      }
      if (body.screenshot_url !== undefined) {
        await sql`
          UPDATE feedback
          SET screenshot_url = ${body.screenshot_url || null}, updated_at = ${now}
          WHERE id = ${id}
        `;
      }
      if (body.priority !== undefined) {
        await sql`
          UPDATE feedback
          SET priority = ${body.priority}, updated_at = ${now}
          WHERE id = ${id}
        `;
      }
      if (body.is_public !== undefined) {
        await sql`
          UPDATE feedback
          SET is_public = ${body.is_public}, updated_at = ${now}
          WHERE id = ${id}
        `;
      }
      if (body.is_anonymous !== undefined) {
        await sql`
          UPDATE feedback
          SET is_anonymous = ${body.is_anonymous}, updated_at = ${now}
          WHERE id = ${id}
        `;
      }
    }

    // Return updated feedback
    const [updated] = await sql`SELECT * FROM feedback WHERE id = ${id}`;

    await logEvent('feedback_updated', 'feedback', id, {
      by_admin: isAdmin,
    }, userId);

    return Response.json(updated);
  } catch (error: any) {
    console.error(`PATCH /api/feedback/${id} error`, error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * DELETE /api/feedback/[id]
 * Delete feedback. Only owner (if SUBMITTED) or admin can delete.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;
  const userRole = (session?.user as { role?: string })?.role;
  const isAdmin = userRole === 'ADMIN';

  try {
    const [existing] = await sql`
      SELECT * FROM feedback WHERE id = ${id}
    `;

    if (!existing) {
      return Response.json({ error: 'Feedback not found' }, { status: 404 });
    }

    const isOwner = existing.user_id === userId;

    // Owner can delete only if status is SUBMITTED
    if (!isAdmin && (!isOwner || existing.status !== 'SUBMITTED')) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    await sql`DELETE FROM feedback WHERE id = ${id}`;

    await logEvent('feedback_deleted', 'feedback', id, {
      by_admin: isAdmin,
    }, userId);

    return Response.json({ success: true });
  } catch (error: any) {
    console.error(`DELETE /api/feedback/${id} error`, error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
