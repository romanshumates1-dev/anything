/**
 * Admin user ban / suspend management (Phase 4). USER-level (the prior version
 * targeted a nonexistent `bans` table at org level — BREAKAGE_TABLE #29).
 *
 * GET    /api/admin/bans            — list banned + currently-suspended users
 * POST   /api/admin/bans            — ban (permanent) or suspend (temporary)
 *   { userId, action: 'ban'|'suspend', reason (required), durationHours? }
 * DELETE /api/admin/bans?userId=xxx — unban / unsuspend
 *
 * Ban/suspend revokes all of the user's sessions immediately; the better-auth
 * session hook + middleware then reject any new login and any surviving
 * session or API token (server-side, not UI-only). ADMIN-only.
 */
import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { adminAudit, clientIp } from '@/app/api/utils/adminAudit';

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const rows = await sql`
      SELECT id, name, email, role, banned, ban_reason, banned_at, banned_by, suspended_until
      FROM "user"
      WHERE banned = true OR (suspended_until IS NOT NULL AND suspended_until > now())
      ORDER BY COALESCE(banned_at, suspended_until) DESC
      LIMIT 200
    `;
    return Response.json(rows);
  } catch (error) {
    console.error('GET /api/admin/bans error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const body = await request.json().catch(() => ({}));
    const { userId, action, reason, durationHours } = body ?? {};

    if (!userId || (action !== 'ban' && action !== 'suspend')) {
      return Response.json({ error: "userId and action ('ban'|'suspend') required" }, { status: 400 });
    }
    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      return Response.json({ error: 'reason is required' }, { status: 400 });
    }

    const [target] = await sql`SELECT id, email, role FROM "user" WHERE id = ${userId} LIMIT 1`;
    if (!target) return Response.json({ error: 'User not found' }, { status: 404 });

    // Don't let an admin lock out the last admin (self-lockout guard, mirrors
    // the role-demotion guard in users/[id]).
    if (target.role === 'ADMIN') {
      const [{ admins }] = await sql`SELECT COUNT(*)::int AS admins FROM "user" WHERE role = 'ADMIN' AND banned = false`;
      if (Number(admins) <= 1) {
        return Response.json({ error: 'Refused: this is the last active admin' }, { status: 400 });
      }
    }

    if (action === 'ban') {
      await sql`
        UPDATE "user"
        SET banned = true, ban_reason = ${reason}, banned_at = now(), banned_by = ${admin.userId},
            suspended_until = NULL, "updatedAt" = now()
        WHERE id = ${userId}
      `;
    } else {
      const hours = Number(durationHours);
      const until = new Date(Date.now() + (Number.isFinite(hours) && hours > 0 ? hours : 24) * 3600 * 1000).toISOString();
      await sql`
        UPDATE "user"
        SET suspended_until = ${until}, ban_reason = ${reason}, "updatedAt" = now()
        WHERE id = ${userId}
      `;
    }

    // Immediate revocation: drop every session so access ends now, not when a
    // cookie expires.
    await sql`DELETE FROM session WHERE "userId" = ${userId}`;

    await adminAudit({
      actorId: admin.userId,
      action: action === 'ban' ? 'user_banned' : 'user_suspended',
      targetType: 'user',
      targetId: userId,
      metadata: { email: target.email, reason, durationHours: action === 'suspend' ? durationHours ?? 24 : null },
      ip: clientIp(request),
    });

    return Response.json({ success: true, action, userId }, { status: 200 });
  } catch (error) {
    console.error('POST /api/admin/bans error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const userId = new URL(request.url).searchParams.get('userId');
  if (!userId) return Response.json({ error: 'userId required' }, { status: 400 });

  try {
    const updated = await sql`
      UPDATE "user"
      SET banned = false, ban_reason = NULL, banned_at = NULL, banned_by = NULL,
          suspended_until = NULL, "updatedAt" = now()
      WHERE id = ${userId} AND (banned = true OR suspended_until IS NOT NULL)
      RETURNING id, email
    `;
    if (updated.length === 0) {
      return Response.json({ error: 'No active ban/suspension for this user' }, { status: 404 });
    }

    await adminAudit({
      actorId: admin.userId,
      action: 'user_unbanned',
      targetType: 'user',
      targetId: userId,
      metadata: { email: updated[0].email },
      ip: clientIp(request),
    });

    return Response.json({ success: true, userId });
  } catch (error) {
    console.error('DELETE /api/admin/bans error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
