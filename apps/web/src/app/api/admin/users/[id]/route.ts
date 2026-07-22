import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { KNOWN_ROLES, ROLE_ADMIN } from '@/app/api/utils/access-control';
import { logEvent } from '@/app/api/utils/logger';
import { adminAudit, clientIp } from '@/app/api/utils/adminAudit';

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
      await adminAudit({
        actorId: admin.userId,
        action: 'user_role_changed',
        targetType: 'user',
        targetId: id,
        metadata: { email: target.email, from: target.role, to: nextRole },
        ip: clientIp(request),
      });
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

/**
 * POST /api/admin/users/[id]  { action: 'force_password_reset' }
 * Invalidates the user's credential + all sessions so they must reset their
 * password on next access. We clear the account's stored password hash (better
 * auth's `account` table) and delete sessions; the user then uses the normal
 * password-reset / re-signup flow. ADMIN-only, audit-logged.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { action?: unknown };
    if (body.action !== 'force_password_reset') {
      return Response.json({ error: "action must be 'force_password_reset'" }, { status: 400 });
    }

    const [target] = await sql`SELECT id, email FROM "user" WHERE id = ${id} LIMIT 1`;
    if (!target) return Response.json({ error: 'User not found' }, { status: 404 });

    // Null the stored credential(s) and revoke sessions. better-auth stores the
    // password hash in account.password for provider 'credential'.
    await sql`UPDATE account SET password = NULL WHERE "userId" = ${id}`;
    await sql`DELETE FROM session WHERE "userId" = ${id}`;

    await logEvent('user_force_password_reset', 'user', id, { email: target.email }, admin.userId);
    await adminAudit({
      actorId: admin.userId,
      action: 'user_force_password_reset',
      targetType: 'user',
      targetId: id,
      metadata: { email: target.email },
      ip: clientIp(request),
    });

    return Response.json({ success: true, action: 'force_password_reset' });
  } catch (error) {
    console.error('POST /api/admin/users/[id] error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/users/[id]  — GDPR soft-delete / anonymize.
 * Scrubs PII (email, name) to non-identifying placeholders, bans the account,
 * and revokes sessions — while PRESERVING financial records (payments_ledger,
 * contracts) for legal retention. Refuses to anonymize the last admin.
 * ADMIN-only, audit-logged.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const { id } = await params;
    const [target] = await sql`SELECT id, email, role FROM "user" WHERE id = ${id} LIMIT 1`;
    if (!target) return Response.json({ error: 'User not found' }, { status: 404 });

    if (target.role === ROLE_ADMIN) {
      const [{ admins }] = await sql`SELECT COUNT(*)::int AS admins FROM "user" WHERE role = ${ROLE_ADMIN} AND banned = false`;
      if (Number(admins) <= 1) {
        return Response.json({ error: 'Refused: this is the last admin' }, { status: 400 });
      }
    }

    const anonEmail = `deleted+${id}@anonymized.invalid`;
    await sql`
      UPDATE "user"
      SET email = ${anonEmail}, name = 'Deleted User', role = 'MEMBER',
          banned = true, ban_reason = 'gdpr_delete', banned_at = now(), banned_by = ${admin.userId},
          "updatedAt" = now()
      WHERE id = ${id}
    `;
    await sql`DELETE FROM session WHERE "userId" = ${id}`;
    await sql`UPDATE account SET password = NULL WHERE "userId" = ${id}`;

    await logEvent('user_gdpr_anonymized', 'user', id, { previous_email: target.email }, admin.userId);
    await adminAudit({
      actorId: admin.userId,
      action: 'user_gdpr_anonymized',
      targetType: 'user',
      targetId: id,
      metadata: { previous_email: target.email, note: 'financial records preserved' },
      ip: clientIp(request),
    });

    return Response.json({ success: true, action: 'gdpr_anonymized' });
  } catch (error) {
    console.error('DELETE /api/admin/users/[id] error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
