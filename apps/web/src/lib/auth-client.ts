/**
 * ⚠ ANYTHING PLATFORM — DO NOT REWRITE THIS FILE ⚠
 *
 * Shipped v2 better-auth client. Signup/signin pages and the mobile app all
 * import from here. Safe to leave as-is; unsafe to pass an explicit baseURL
 * (relative paths are correct — the pages + mobile WebView handle origin
 * routing via trustedOrigins on the server).
 */
import { createAuthClient } from 'better-auth/react';
import { useCallback, useEffect, useState } from 'react';

export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession: useBetterAuthSession } = authClient;

/**
 * Bounded automatic retries for a transient session-fetch failure (the
 * "random sign-out" fix, frontend half).
 *
 * While retrying, the hook reports `isPending: true` so that every page's
 * existing loading branch shows a spinner instead of interpreting the blip
 * as "signed out" (all 29+ pages render a spinner when isPending and only
 * redirect when !session settles). Only after the retry budget is exhausted
 * do we surface `isSessionError: true` for pages that want an explicit
 * retry UI (see AuthGate); naive pages then behave exactly as they did
 * before this fix (redirect), but only after 2 real retries over ~2s.
 *
 * Genuine sign-out (data:null + error:null) is NOT retried, and neither is a
 * positively-rejected session (4xx from the session endpoint, e.g. 401 after
 * server-side RBAC revocation or cookie expiry): those are authoritative
 * "not authenticated" answers, so they surface immediately and the user is
 * sent to sign-in exactly as before this fix.
 *
 * NOTE ON better-auth SEMANTICS (dist/client/query.mjs): every failure sets
 * `error`; only HTTP 401 additionally nulls `data`. A transient 500/network
 * blip therefore looks identical to a revocation *except* for `error.status`,
 * which is what this wrapper keys off.
 */
const MAX_TRANSIENT_RETRIES = 2;
const RETRY_DELAYS_MS = [500, 1500] as const;

/** HTTP status carried by better-fetch errors, when there is one. */
function errorStatus(error: unknown): number | undefined {
  if (error && typeof error === 'object') {
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number' && Number.isFinite(status)) return status;
  }
  return undefined;
}

/**
 * True when the session endpoint gave an authoritative client-error answer
 * (4xx). Those are decided, not transient: retrying cannot help, and the user
 * must observe the real state (e.g. revoked access -> signed out).
 */
function isRejectedAuthError(error: unknown): boolean {
  const status = errorStatus(error);
  return status != null && status >= 400 && status < 500;
}

export function useSession() {
  const session = useBetterAuthSession();
  const { data, isPending, error, refetch } = session;
  const [retryCount, setRetryCount] = useState(0);

  /**
   * Fetch settled with an error, no session data, and no authoritative
   * rejection — auth state is UNKNOWN (network/5xx/timeout), so retry.
   */
  const isTransientError =
    !isPending && data == null && error != null && !isRejectedAuthError(error);

  // A successful (or genuine-sign-out) resolution resets the retry budget,
  // so a later transient blip gets a fresh set of retries.
  useEffect(() => {
    if (data != null) {
      setRetryCount(0);
    }
  }, [data]);

  useEffect(() => {
    if (!isTransientError || retryCount >= MAX_TRANSIENT_RETRIES) return;
    const delay = RETRY_DELAYS_MS[Math.min(retryCount, RETRY_DELAYS_MS.length - 1)];
    const timer = setTimeout(() => {
      setRetryCount((n) => n + 1);
      void refetch();
    }, delay);
    return () => clearTimeout(timer);
  }, [isTransientError, retryCount, refetch]);

  const retrySession = useCallback(() => {
    // Manual retry restarts the bounded window so a user-initiated retry gets
    // the same two automatic attempts a cold transient failure would get.
    setRetryCount(0);
    void refetch();
  }, [refetch]);

  return {
    ...session,
    /** True while the bounded auto-retry is still in flight. */
    isPending: isPending || (isTransientError && retryCount < MAX_TRANSIENT_RETRIES),
    /** True only when transient retries are exhausted — auth state still UNKNOWN. */
    isSessionError: isTransientError && retryCount >= MAX_TRANSIENT_RETRIES,
    /** Manual re-run of the session fetch (AuthGate retry button). */
    retrySession,
  };
}
