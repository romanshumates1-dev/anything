/**
 * Session authentication utility for API routes.
 * Uses better-auth to verify the session from request headers.
 */
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';

export interface SessionData {
  userId: string;
  email: string;
  name?: string;
  role?: string;
}

/**
 * Require an authenticated session for API routes.
 * Returns session data if authenticated, null otherwise.
 */
export async function requireSession(): Promise<SessionData | null> {
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList });

  if (!session || !session.user) {
    return null;
  }

  return {
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name || undefined,
    role: (session.user as { role?: string }).role || 'MEMBER',
  };
}
