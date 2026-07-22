import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { logEvent } from '@/app/api/utils/logger';

/**
 * Admin reviews moderation endpoint.
 * GET: List pending reviews
 * POST: Approve or reject reviews
 */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const pendingReviews = await sql`
      SELECT 
        r.id,
        r.rating,
        r.title,
        r.body,
        r.created_at,
        r.status,
        r.is_demo,
        r.admin_note,
        u.name as user_name,
        u.email as user_email
      FROM reviews r
      LEFT JOIN "user" u ON r.user_id = u.id
      WHERE r.status = 'pending'
      ORDER BY r.created_at ASC
      LIMIT 100
    `;

    return Response.json(pendingReviews);
  } catch (error) {
    console.error('GET /api/admin/reviews error', error);
    return Response.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch pending reviews' } }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const body = await request.json();
    const { reviewId, action, reason } = body;

    if (!reviewId || !['approve', 'reject'].includes(action)) {
      return Response.json(
        { error: { code: 'INVALID_INPUT', message: 'reviewId and action (approve/reject) required' } },
        { status: 400 }
      );
    }

    const [review] = await sql`
      SELECT id, user_id, rating, admin_note FROM reviews WHERE id = ${reviewId} LIMIT 1
    `;

    if (!review) {
      return Response.json({ error: { code: 'NOT_FOUND', message: 'Review not found' } }, { status: 404 });
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    // Only a PENDING review can be moderated — otherwise an admin could flip
    // an already-approved/rejected review back and forth outside the normal
    // submit -> pending -> moderate flow.
    const [updated] = await sql`
      UPDATE reviews
      SET status = ${newStatus}, admin_note = ${reason || null}, updated_at = now()
      WHERE id = ${reviewId} AND status = 'pending'
      RETURNING id, status
    `;
    if (!updated) {
      return Response.json(
        { error: { code: 'CONFLICT', message: 'Review is not pending (already moderated)' } },
        { status: 409 }
      );
    }

    // Log to audit
    await sql`
      INSERT INTO review_audit_log (id, actor_id, action, review_id, reason, ip)
      VALUES ('rev_audit_' || gen_random_uuid()::text, ${admin.userId}, ${action}, ${reviewId}, ${reason || null}, ${getClientIP(request)})
    `;

    // Log event
    await logEvent(`review_${action}d`, 'review', reviewId, {
      adminNote: reason,
      changedBy: admin.email,
    });

    return Response.json(updated);
  } catch (error) {
    console.error('POST /api/admin/reviews error', error);
    return Response.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to process review action' } }, { status: 500 });
  }
}

function getClientIP(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}