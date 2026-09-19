import sql from '@/app/api/utils/sql';
import { requireAdmin } from '../../../utils/authz';
import { logEvent } from '../../../utils/logger';

/**
 * POST /api/feedback/[id]/response
 * Add admin response to feedback (ADMIN only).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Require admin
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    // Check if feedback exists
    const [feedback] = await sql`
      SELECT id FROM feedback WHERE id = ${id}
    `;

    if (!feedback) {
      return Response.json({ error: 'Feedback not found' }, { status: 404 });
    }

    const body = await request.json();
    const { response, is_public = true } = body;

    if (!response || typeof response !== 'string' || response.trim().length < 5) {
      return Response.json({ error: 'Response is required (min 5 characters)' }, { status: 400 });
    }

    const [feedbackResponse] = await sql`
      INSERT INTO feedback_responses (
        feedback_id,
        admin_id,
        response,
        is_public
      )
      VALUES (
        ${id},
        ${admin.userId},
        ${response.trim()},
        ${is_public}
      )
      RETURNING *
    `;

    // Also update the feedback status to UNDER_REVIEW if it's still SUBMITTED
    await sql`
      UPDATE feedback
      SET
        status = CASE WHEN status = 'SUBMITTED' THEN 'UNDER_REVIEW' ELSE status END,
        updated_at = now()
      WHERE id = ${id}
    `;

    await logEvent('feedback_response_added', 'feedback', id, {
      response_id: feedbackResponse.id,
      is_public,
    }, admin.userId);

    return Response.json(feedbackResponse, { status: 201 });
  } catch (error: any) {
    console.error(`POST /api/feedback/${id}/response error`, error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * GET /api/feedback/[id]/response
 * Get all responses for a feedback item.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Check admin status for visibility
  const admin = await requireAdmin();
  const isAdmin = admin.ok;

  try {
    const responses = await sql`
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
        AND (fr.is_public = true OR ${isAdmin})
      ORDER BY fr.created_at ASC
    `;

    return Response.json(responses);
  } catch (error: any) {
    console.error(`GET /api/feedback/${id}/response error`, error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
