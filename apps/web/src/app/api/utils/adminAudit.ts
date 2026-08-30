import sql from '@/app/api/utils/sql';

/**
 * Write one row to admin_audit_log (migration 034). Every admin MUTATION must
 * call this — Phase 4 DoD asserts each admin action produces an audit row.
 * Best-effort like logEvent: a failed audit write is logged but never blocks
 * the action's response (the action already happened).
 */
export async function adminAudit(params: {
  actorId: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}): Promise<void> {
  try {
    await sql`
      INSERT INTO admin_audit_log (id, actor_id, action, target_type, target_id, metadata, ip)
      VALUES (
        'audit_' || gen_random_uuid()::text,
        ${params.actorId},
        ${params.action},
        ${params.targetType},
        ${params.targetId ?? null},
        ${params.metadata ? JSON.stringify(params.metadata) : null},
        ${params.ip ?? null}
      )
    `;
  } catch (error) {
    console.error('adminAudit write failed', error);
  }
}

export function clientIp(request: Request): string | null {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
}
