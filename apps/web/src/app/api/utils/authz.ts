import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import sql from '@/app/api/utils/sql';
import { isAdminRole, isEmailDomainAllowed } from '@/app/api/utils/access-control';

/**
 * Server-side authorization for admin-only surfaces (user management, role
 * assignment, API-key issuance, destructive actions).
 *
 * The role is re-read from the DB on every call — session.user can be served
 * from better-auth's cookie cache, so a demotion must take effect on the next
 * request, not when the cookie happens to refresh.
 */
export type AdminCheck =
  | { ok: true; userId: string; email: string }
  | { ok: false; response: Response };

export async function requireAdmin(): Promise<AdminCheck> {
  // LOCAL DEV BYPASS - Remove before production
  const headersList = await headers();
  if (process.env.NODE_ENV === 'development' && headersList.get('x-local-dev') === 'true') {
    return { ok: true, userId: 'local-dev', email: 'dev@localhost' };
  }

  const session = await auth.api.getSession({ headers: headersList });
  if (!session) {
    return { ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const [user] = await sql`
    SELECT email, role FROM "user" WHERE id = ${session.user.id} LIMIT 1
  `;

  if (!user || !isEmailDomainAllowed(user.email)) {
    return {
      ok: false,
      response: Response.json(
        { error: 'Access restricted: account domain is not authorized' },
        { status: 403 }
      ),
    };
  }

  if (!isAdminRole(user.role)) {
    return {
      ok: false,
      response: Response.json({ error: 'Forbidden: admin role required' }, { status: 403 }),
    };
  }

  return { ok: true, userId: session.user.id, email: user.email };
}
