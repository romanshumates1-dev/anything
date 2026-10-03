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
    // NEXT.JS DYNAMIC-ROUTE SIGNAL — MUST NOT BE SWALLOWED (found 2026-10-03).
    //
    // Next.js uses a THROWN error as control flow: when a server component
    // calls `headers()` during static generation, Next throws
    // `DynamicServerError` to tell the build "this route is dynamic, render it
    // per-request instead of pre-rendering it". Catching it and returning null
    // converts that instruction into an ordinary render, so the route is baked
    // as STATIC and the per-request headers never reach it at runtime.
    //
    // The build log showed exactly that for the pages this helper was added to:
    //
    //   Route / couldn't be rendered statically because it used `headers`
    //   Route /automation ...  Route /admin/audience ...
    //
    // So this catch must re-throw the framework's signal and contain only
    // genuine authentication failures. `DIGEST` is how Next tags it; matching
    // the message as well keeps the check honest if that marker ever changes.
    const isDynamicSignal =
      typeof err === 'object' &&
      err !== null &&
      'digest' in err &&
      typeof (err as { digest?: unknown }).digest === 'string' &&
      /DYNAMIC_SERVER_USAGE/i.test((err as { digest: string }).digest);

    if (isDynamicSignal) throw err;

    console.error('[session] getSession failed; rendering without a session:', err);
    return null;
  }
}
