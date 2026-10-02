import { redirect } from 'next/navigation';
import { getSessionOrNull } from '@/lib/session';
import sql from '@/app/api/utils/sql';
import { isAdminRole } from '@/app/api/utils/access-control';
import { isEmailDomainAllowedEffective } from '@/app/api/utils/email-domain-policy';

/**
 * Server-side guard for /admin PAGES. Mirrors requireAdmin (used by the admin
 * APIs) but redirects instead of returning JSON. The APIs are the real
 * enforcement — this only decides whether to render the shell. Role is
 * re-read from the DB every call (never trusts a cached session).
 */
export async function requireAdminPage(): Promise<{ userId: string; email: string }> {
  // Contained read: an auth-backend failure renders as signed-out (redirect to
  // signin), never as a 500. See src/lib/session.ts for the observed defect.
  const session = await getSessionOrNull();
  if (!session) redirect('/account/signin?callbackUrl=%2Fadmin');

  const [user] = await sql`SELECT email, role FROM "user" WHERE id = ${session.user.id} LIMIT 1`;
  if (!user || !(await isEmailDomainAllowedEffective(user.email))) redirect('/access-restricted');
  if (!isAdminRole(user.role)) redirect('/pending-access');

  return { userId: session.user.id, email: user.email };
}
