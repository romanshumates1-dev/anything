import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';

export async function GET() {
  // Job-queue depth is admin-only. This route sits in the middleware's
  // /api/system exemption, so it must gate itself.
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  try {
    const [agg] = await sql`
      SELECT
        count(*) FILTER (WHERE status = 'pending') AS waiting,
        count(*) FILTER (WHERE status = 'processing') AS active,
        count(*) FILTER (WHERE status = 'completed') AS completed,
        count(*) FILTER (WHERE status = 'failed') AS failed,
        count(*) FILTER (WHERE status = 'dead') AS dead
      FROM jobs
    `;

    return Response.json({
      waiting: parseInt(agg?.waiting || '0', 10),
      active: parseInt(agg?.active || '0', 10),
      completed: parseInt(agg?.completed || '0', 10),
      failed: parseInt(agg?.failed || '0', 10),
      dead: parseInt(agg?.dead || '0', 10),
      workers: 1,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return Response.json({
      error: error?.message || 'unknown',
      timestamp: new Date().toISOString(),
    }, { status: 503 });
  }
}