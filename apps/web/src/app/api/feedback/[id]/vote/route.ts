import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { logEvent } from '../../../utils/logger';

/**
 * POST /api/feedback/[id]/vote
 * Toggle vote on a feedback item. If user has voted, removes vote. If not, adds vote.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;

  try {
    // Check if feedback exists and is public (or user's own)
    const [feedback] = await sql`
      SELECT id, is_public, user_id, vote_count
      FROM feedback
      WHERE id = ${id}
    `;

    if (!feedback) {
      return Response.json({ error: 'Feedback not found' }, { status: 404 });
    }

    // Users can only vote on public feedback or their own
    if (!feedback.is_public && feedback.user_id !== userId) {
      return Response.json({ error: 'Cannot vote on private feedback' }, { status: 403 });
    }

    // Check if user has already voted
    const [existingVote] = await sql`
      SELECT id FROM feedback_votes
      WHERE feedback_id = ${id} AND user_id = ${userId}
    `;

    if (existingVote) {
      // Remove vote
      await sql`
        DELETE FROM feedback_votes
        WHERE feedback_id = ${id} AND user_id = ${userId}
      `;
      await sql`
        UPDATE feedback
        SET vote_count = vote_count - 1, updated_at = now()
        WHERE id = ${id}
      `;

      await logEvent('feedback_unvoted', 'feedback', id, {}, userId);

      const [updated] = await sql`SELECT vote_count FROM feedback WHERE id = ${id}`;
      return Response.json({
        voted: false,
        vote_count: updated.vote_count,
      });
    } else {
      // Add vote
      await sql`
        INSERT INTO feedback_votes (feedback_id, user_id)
        VALUES (${id}, ${userId})
      `;
      await sql`
        UPDATE feedback
        SET vote_count = vote_count + 1, updated_at = now()
        WHERE id = ${id}
      `;

      await logEvent('feedback_voted', 'feedback', id, {}, userId);

      const [updated] = await sql`SELECT vote_count FROM feedback WHERE id = ${id}`;
      return Response.json({
        voted: true,
        vote_count: updated.vote_count,
      });
    }
  } catch (error: any) {
    console.error(`POST /api/feedback/${id}/vote error`, error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * GET /api/feedback/[id]/vote
 * Check if current user has voted on this feedback.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ voted: false });
  }

  const userId = session.user.id;

  try {
    const [vote] = await sql`
      SELECT id FROM feedback_votes
      WHERE feedback_id = ${id} AND user_id = ${userId}
    `;

    return Response.json({ voted: !!vote });
  } catch (error: any) {
    console.error(`GET /api/feedback/${id}/vote error`, error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
