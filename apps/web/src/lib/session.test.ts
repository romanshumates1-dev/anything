/**
 * CONTAINED SESSION READ — BEHAVIOURAL TEST.
 *
 * THE DEFECT THIS EXISTS FOR (observed, not hypothesised)
 * ------------------------------------------------------
 * A real-browser authenticated crawl of the running app recorded:
 *
 *   GET /api/auth/get-session 500 in 11.9s (next.js: 33ms, proxy.ts: 11ms,
 *                                            application-code: 11.8s)
 *   GET / 500                    in 12.6s (next.js: 80ms, application-code: 12.5s)
 *
 * `application-code` burned ~12s and then failed. The public homepage renders by
 * awaiting `auth.api.getSession(...)` with NO error handling:
 *
 *   // src/app/(marketing)/page.tsx (before this fix)
 *   const session = await auth.api.getSession({ headers: await headers() });
 *   if (session) redirect("/dashboard");
 *
 * So a slow or failing session lookup — a cold database, a transient auth
 * backend error, a timeout — does not degrade the homepage. It returns HTTP 500
 * and the visitor sees "an unknown error occurred while rendering the page" for
 * a page that never needed a session in the first place.
 *
 * THE RULE
 * --------
 * A server component must not let an AUTHENTICATION failure become a RENDERING
 * failure. "We could not tell you who this is" and "this page is broken" are
 * different statements, and only the second one may produce a 500.
 *
 * `getSessionOrNull()` therefore resolves to `null` on failure instead of
 * rejecting, and logs the reason so the failure is still visible in monitoring
 * rather than silently swallowed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `vi.mock` factories are hoisted above the imports, so the mock must be
// created with `vi.hoisted` — referencing a plain top-level `const` here would
// throw "Cannot access before initialization" at collection time.
const { getSessionMock } = vi.hoisted(() => ({ getSessionMock: vi.fn() }));

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: (args: unknown) => getSessionMock(args),
    },
  },
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}));

import { getSessionOrNull } from '@/lib/session';

describe('getSessionOrNull', () => {
  beforeEach(() => {
    getSessionMock.mockReset();
  });

  it('returns the session unchanged when the lookup succeeds', async () => {
    const session = { session: { id: 's-1' }, user: { id: 'u-1' } };
    getSessionMock.mockResolvedValue(session);

    await expect(getSessionOrNull()).resolves.toBe(session);
  });

  it('resolves to null (never rejects) when the lookup throws', async () => {
    // The exact error the real browser crawl surfaced.
    getSessionMock.mockRejectedValue(new Error('APIError: Failed to get session'));

    await expect(getSessionOrNull()).resolves.toBeNull();
  });

  it('resolves to null when the lookup resolves undefined (better-auth miss)', async () => {
    getSessionMock.mockResolvedValue(undefined);

    await expect(getSessionOrNull()).resolves.toBeNull();
  });

  it('logs the failure so it stays visible in monitoring instead of being swallowed', async () => {
    getSessionMock.mockRejectedValue(new Error('APIError: Failed to get session'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await getSessionOrNull();

      expect(errorSpy).toHaveBeenCalledTimes(1);
      // The reason must survive into the log; a bare "session failed" is not
      // enough to debug a production incident.
      expect(String(errorSpy.mock.calls[0].join(' '))).toContain('Failed to get session');
    } finally {
      errorSpy.mockRestore();
    }
  });

  describe("Next.js's dynamic-route signal must NOT be contained", () => {
    // REGRESSION, found 2026-10-03 in the Cloudflare build log.
    //
    // Next.js signals "render this per-request, not at build time" by THROWING
    // from `headers()`. This helper's catch-all was swallowing that signal and
    // returning null, which made the build treat the route as an ordinary static
    // render:
    //
    //   Route / couldn't be rendered statically because it used `headers`
    //   Route /automation ...  Route /admin/audience ...
    //
    // The visible symptom is a page that builds and deploys but cannot read the
    // request headers it needs at runtime — i.e. session state that is always
    // empty, which quietly breaks every signed-in feature on that route.
    //
    // The containment fix must contain AUTHENTICATION failures, not framework
    // control flow. These two are easy to confuse and must not be.
    function dynamicServerError() {
      const err = new Error(
        'Dynamic server usage: Route / couldn\'t be rendered statically because it used `headers`.',
      );
      // Next tags its control-flow errors with this digest.
      (err as Error & { digest: string }).digest = 'DYNAMIC_SERVER_USAGE';
      return err;
    }

    it('re-throws the dynamic-usage signal instead of returning null', async () => {
      getSessionMock.mockRejectedValue(dynamicServerError());
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        // Returning null here is the bug: it converts Next's instruction into
        // a successful static render.
        await expect(getSessionOrNull()).rejects.toThrow(/Dynamic server usage/);
        // And it must not be logged as an auth outage — it is not one.
        expect(errorSpy).not.toHaveBeenCalled();
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('still contains a genuine auth failure', async () => {
      // The counter-test: containing real auth failures is the whole point of
      // the helper and must survive the re-throw change.
      getSessionMock.mockRejectedValue(new Error('APIError: Failed to get session'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        await expect(getSessionOrNull()).resolves.toBeNull();
        expect(errorSpy).toHaveBeenCalledTimes(1);
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('still contains a backend timeout, which carries no digest', async () => {
      getSessionMock.mockRejectedValue(new Error('ETIMEDOUT'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        await expect(getSessionOrNull()).resolves.toBeNull();
      } finally {
        errorSpy.mockRestore();
      }
    });
  });
});
