import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';

/**
 * Admin audit log viewer. ADMIN-only.
 * GET /api/admin/audit-log?action=&targetType=&limit=&offset=
 *
 * Rewritten (Phase 4): the prior version declared `let total` then reassigned a
 * shadowing inner `const [{ total }]` in every branch, so pagination.total was
 * always undefined (BREAKAGE_TABLE #29 note). Also collapses four near-identical
 * query branches into one filter passed as bound params.
 */
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const targetType = url.searchParams.get('targetType');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 500);
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);

  try {
    const logs = await sql`
      SELECT
        a.id, a.actor_id, u.email AS actor_email, a.action,
        a.target_type, a.target_id, a.metadata, a.ip, a.created_at
      FROM admin_audit_log a
      LEFT JOIN "user" u ON u.id = a.actor_id
      WHERE (${action}::text IS NULL OR a.action = ${action})
        AND (${targetType}::text IS NULL OR a.target_type = ${targetType})
      ORDER BY a.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const [{ total }] = await sql`
      SELECT COUNT(*)::int AS total FROM admin_audit_log a
      WHERE (${action}::text IS NULL OR a.action = ${action})
        AND (${targetType}::text IS NULL OR a.target_type = ${targetType})
    `;

    return Response.json({ logs, pagination: { limit, offset, total } });
  } catch (error) {
    console.error('GET /api/admin/audit-log error', error);
    return Response.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch audit log' } }, { status: 500 });
  }
}
