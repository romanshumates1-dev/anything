import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import sql from '@/app/api/utils/sql';
import { isAdminRole, isEmailDomainAllowed } from '@/app/api/utils/access-control';

/**
 * Server-side guard for /admin PAGES. Mirrors requireAdmin (used by the admin
 * APIs) but redirects instead of returning JSON. The APIs are the real
 * enforcement — this only decides whether to render the shell. Role is
 * re-read from the DB every call (never trusts a cached session).
 */
export async function requireAdminPage(): Promise<{ userId: string; email: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/account/signin?callbackUrl=%2Fadmin');

  const [user] = await sql`SELECT email, role FROM "user" WHERE id = ${session.user.id} LIMIT 1`;
  if (!user || !isEmailDomainAllowed(user.email)) redirect('/access-restricted');
  if (!isAdminRole(user.role)) redirect('/pending-access');

  return { userId: session.user.id, email: user.email };
}
