import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';

/**
 * Admin audit log endpoint.
 * GET: List audit log entries with optional filtering
 */
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const targetType = url.searchParams.get('targetType');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  try {
    let logs;
    let total;

    if (action && targetType) {
      logs = await sql`
        SELECT 
          id,
          actor_id,
          action,
          target_type,
          target_id,
          metadata,
          ip,
          created_at
        FROM admin_audit_log
        WHERE action = ${action} AND target_type = ${targetType}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
      const [{ total }] = await sql`
        SELECT COUNT(*)::int as total FROM admin_audit_log
        WHERE action = ${action} AND target_type = ${targetType}
      `;
    } else if (action) {
      logs = await sql`
        SELECT 
          id,
          actor_id,
          action,
          target_type,
          target_id,
          metadata,
          ip,
          created_at
        FROM admin_audit_log
        WHERE action = ${action}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
      const [{ total }] = await sql`
        SELECT COUNT(*)::int as total FROM admin_audit_log
        WHERE action = ${action}
      `;
    } else if (targetType) {
      logs = await sql`
        SELECT 
          id,
          actor_id,
          action,
          target_type,
          target_id,
          metadata,
          ip,
          created_at
        FROM admin_audit_log
        WHERE target_type = ${targetType}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
      const [{ total }] = await sql`
        SELECT COUNT(*)::int as total FROM admin_audit_log
        WHERE target_type = ${targetType}
      `;
    } else {
      logs = await sql`
        SELECT 
          id,
          actor_id,
          action,
          target_type,
          target_id,
          metadata,
          ip,
          created_at
        FROM admin_audit_log
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
      const [{ total }] = await sql`
        SELECT COUNT(*)::int as total FROM admin_audit_log
      `;
    }

    return Response.json({
      logs,
      pagination: { limit, offset, total }
    });
  } catch (error) {
    console.error('GET /api/admin/audit-log error', error);
    return Response.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch audit log' } }, { status: 500 });
  }
}