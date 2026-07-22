import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';

/**
 * Admin user management — list every account with its role and access state.
 * ADMIN-only (server-enforced via requireAdmin; the middleware role gate is a
 * second, independent layer in front of this).
 */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const users = await sql`
      SELECT
        u.id,
        u.name,
        u.email,
        u.role,
        u.banned,
        u.ban_reason,
        u.suspended_until,
        u."createdAt" AS created_at,
        (SELECT MAX(s."createdAt") FROM session s WHERE s."userId" = u.id) AS last_login_at,
        (SELECT COUNT(*)::int FROM session s WHERE s."userId" = u.id AND s."expiresAt" > now()) AS active_sessions
      FROM "user" u
      ORDER BY u."createdAt" ASC
      LIMIT 500
    `;
    return Response.json(users);
  } catch (error) {
    console.error('GET /api/admin/users error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
