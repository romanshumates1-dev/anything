import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { KNOWN_ROLES, ROLE_ADMIN } from '@/app/api/utils/access-control';
import { logEvent } from '@/app/api/utils/logger';

/**
 * Admin role assignment + access revocation for a single user. ADMIN-only.
 *
 * Body: { role?: 'ADMIN' | 'MEMBER', revokeSessions?: boolean }
 *  - Demoting an ADMIN (including yourself) is refused when it would leave
 *    zero admins — the platform must always keep ≥1 admin (no self-lockout).
 *  - Any demotion deletes the target's sessions so the change takes effect
 *    immediately instead of when their cookie cache expires.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      role?: unknown;
      revokeSessions?: unknown;
    };

    const nextRole = typeof body.role === 'string' ? body.role.toUpperCase() : undefined;
    const revokeSessions = body.revokeSessions === true;

    if (nextRole !== undefined && !(KNOWN_ROLES as readonly string[]).includes(nextRole)) {
      return Response.json({ error: `role must be one of ${KNOWN_ROLES.join(', ')}` }, { status: 400 });
    }
    if (nextRole === undefined && !revokeSessions) {
      return Response.json({ error: 'Nothing to do: provide role and/or revokeSessions' }, { status: 400 });
    }

    const [target] = await sql`SELECT id, email, role FROM "user" WHERE id = ${id} LIMIT 1`;
    if (!target) return Response.json({ error: 'User not found' }, { status: 404 });

    const isDemotion = nextRole !== undefined && target.role === ROLE_ADMIN && nextRole !== ROLE_ADMIN;
    if (isDemotion) {
      const [{ admins }] = await sql`
        SELECT COUNT(*)::int AS admins FROM "user" WHERE role = ${ROLE_ADMIN}
      `;
      if (Number(admins) <= 1) {
        return Response.json(
          { error: 'Refused: this is the last admin — promote another admin first' },
          { status: 400 }
        );
      }
    }

    let updated = target;
    if (nextRole !== undefined && nextRole !== target.role) {
      [updated] = await sql`
        UPDATE "user" SET role = ${nextRole}, "updatedAt" = now()
        WHERE id = ${id}
        RETURNING id, email, role
      `;
      await logEvent(
        'user_role_changed',
        'user',
        id,
        { email: target.email, from: target.role, to: nextRole, changed_by: admin.email },
        admin.userId
      );
    }

    if (revokeSessions || isDemotion) {
      await sql`DELETE FROM session WHERE "userId" = ${id}`;
      await logEvent(
        'user_sessions_revoked',
        'user',
        id,
        { email: target.email, revoked_by: admin.email },
        admin.userId
      );
    }

    return Response.json({
      id: updated.id,
      email: updated.email,
      role: updated.role,
      sessionsRevoked: revokeSessions || isDemotion,
    });
  } catch (error) {
    console.error('PATCH /api/admin/users/[id] error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
