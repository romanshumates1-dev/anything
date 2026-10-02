import { headers } from 'next/headers';
import { auth, type Session } from '@/lib/auth';

/**
 * CONTAINED SESSION READ (2026-10-02).
 *
 * Read this before replacing it with a bare `auth.api.getSession(...)`.
 *
 * THE OBSERVED DEFECT (real-browser authenticated crawl, not a hypothesis):
 *
 *   GET /api/auth/get-session 500 in 11.9s (application-code: 11.8s)
 *   GET / 500                    in 12.6s (application-code: 12.5s)
 *
 * The public homepage (`src/app/(marketing)/page.tsx`) awaited
 * `auth.api.getSession(...)` with NO error handling. A slow or failing session
 * lookup — cold database, transient auth backend error, timeout — did not
 * degrade the page. It returned HTTP 500, and visitors saw "an unknown error
 * occurred while rendering the page" for a page that never needed a session.
 *
 * THE RULE: a server component must not let an AUTHENTICATION failure become
 * a RENDERING failure. "We could not tell you who this is" and "this page is
 * broken" are different statements, and only the second one may produce a 500.
 *
 * `getSessionOrNull()` therefore resolves to `null` on failure instead of
 * rejecting, and logs the reason so the failure stays visible in monitoring
 * rather than being silently swallowed.
 *
 * SCOPE: page-level renders (`page.tsx` / `layout.tsx` / `adminGuard.ts`).
 * API `route.ts` handlers are out of scope — a throw there returns a JSON 500
 * for one endpoint and cannot take out a public page.
 */
export async function getSessionOrNull(): Promise<Session | null> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    return session ?? null;
  } catch (err) {
    console.error('[session] getSession failed; rendering without a session:', err);
    return null;
  }
}
