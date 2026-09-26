// Regression tests for the session wrapper in src/lib/auth-client.ts.
//
// The production bug these lock down: better-auth's session query sets
// `error` for EVERY failure but only nulls `data` on HTTP 401
// (node_modules/better-auth/dist/client/query.mjs, onError). A transient
// 500/network blip therefore reaches pages as `data === null`, and the
// widespread `if (!session) router.replace('/account/signin')` pattern
// interpreted that blip as "signed out" -> the reported random sign-outs.
//
// Contract under test:
//   healthy session            -> passed through untouched
//   transient error (no 4xx)   -> isPending stays true while bounded
//                                 auto-retry runs; isSessionError once spent
//   genuine sign-out           -> data null, no error, terminal immediately
//   authoritative 4xx (401)    -> terminal immediately, NOT retried
//
// The mock below mirrors the real atom: `refetch` is created ONCE and is
// referentially stable across every state transition (query.mjs lines 6-12,
// 32, 47, 58, 68 all preserve `value.value.refetch`). A per-render mock would
// churn the wrapper's retry effect and mask the behavior under test.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useSession } from './auth-client';

type SessionState = {
  data: unknown;
  error: unknown;
  isPending: boolean;
  isRefetching: boolean;
};

/** MAX_TRANSIENT_RETRIES in auth-client.ts (delays: 500ms then 1500ms). */
const EXPECTED_RETRIES = 2;

// Hoisted so the vi.mock factory (hoisted above imports) can reach them.
const h = vi.hoisted(() => {
  /** What the "server" currently reports through the session atom. */
  const state: { payload: SessionState | null } = { payload: null };
  /** Stable refetch, exactly like the real atom's `refetch` property. */
  const refetch = vi.fn(async () => {});
  return { state, refetch };
});

vi.mock('better-auth/react', () => {
  // auth-client.ts runs `createAuthClient()` at module scope and destructures
  // { signIn, signUp, signOut, useSession } off the returned client, so the
  // factory must expose createAuthClient returning that same surface.
  const useSessionImpl = () => ({ ...(h.state.payload as object), refetch: h.refetch });
  return {
    createAuthClient: vi.fn(() => ({
      useSession: useSessionImpl,
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
    })),
    useSession: useSessionImpl,
  };
});

function setSession(state: SessionState | null) {
  h.state.payload = state;
}

beforeEach(() => {
  h.refetch.mockClear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useSession wrapper: session-fetch failure contract', () => {
  it('passes through a healthy authenticated session untouched', () => {
    setSession({
      data: { user: { id: 'u1', role: 'user' }, session: { id: 's1' } },
      error: null,
      isPending: false,
      isRefetching: false,
    });
    const { result } = renderHook(() => useSession());

    expect(result.current.data).toEqual({
      user: { id: 'u1', role: 'user' },
      session: { id: 's1' },
    });
    expect(result.current.isPending).toBe(false);
    expect(result.current.isSessionError).toBe(false);
    expect(h.refetch).not.toHaveBeenCalled();
  });

  it('does NOT report a signed-out state while a transient failure is being retried', () => {
    setSession({
      data: null,
      error: { status: 500, message: 'session fetch failed' },
      isPending: false,
      isRefetching: false,
    });
    const { result } = renderHook(() => useSession());

    // This is the random-sign-out fix: the blip must present as "still
    // loading" (spinner) instead of `data: null` (redirect to signin).
    expect(result.current.isPending).toBe(true);
    expect(result.current.isSessionError).toBe(false);
  });

  it('auto-retries a transient failure a bounded number of times, then surfaces isSessionError', async () => {
    setSession({
      data: null,
      error: { status: 503, message: 'service unavailable' },
      isPending: false,
      isRefetching: false,
    });
    const { result } = renderHook(() => useSession());

    // Each retry is scheduled by the effect pass *after* the previous failure
    // was processed, so the clock must tick through several resolution cycles:
    // one long jump only fires the 500ms timer, leaving the 1500ms follow-up
    // scheduled at the end of the jumped window. Four bounded cycles cover the
    // two-retry budget with slack while keeping the assertion deterministic.
    for (let cycle = 0; cycle < 4; cycle++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
    }

    await waitFor(() => expect(result.current.isSessionError).toBe(true));
    // Bounded: exactly the configured budget, never an infinite retry loop.
    expect(h.refetch).toHaveBeenCalledTimes(EXPECTED_RETRIES);
    // Auth state is still UNKNOWN, so callers must not redirect to signin.
    expect(result.current.isPending).toBe(false);
    expect(result.current.data).toBeNull();
  });

  it('does NOT mask a genuine signed-out state (data null, no error)', async () => {
    setSession({ data: null, error: null, isPending: false, isRefetching: false });
    const { result } = renderHook(() => useSession());

    expect(result.current.data).toBeNull();
    expect(result.current.isPending).toBe(false);
    expect(result.current.isSessionError).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    // A real sign-out is authoritative: no retry, no error surface.
    expect(h.refetch).not.toHaveBeenCalled();
    expect(result.current.isSessionError).toBe(false);
  });

  it('treats an authoritative 4xx (401 revocation/expiry) as terminal, not transient', async () => {
    setSession({
      data: null,
      error: { status: 401, message: 'Unauthorized' },
      isPending: false,
      isRefetching: false,
    });
    const { result } = renderHook(() => useSession());

    // Terminal right away: retrying cannot help, and pages must be free to
    // send the user to sign-in exactly as before this fix.
    expect(result.current.isPending).toBe(false);
    expect(result.current.isSessionError).toBe(false);
    expect(result.current.data).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(h.refetch).not.toHaveBeenCalled();
  });

  it('recovers to the authenticated state when the session fetch succeeds mid-window', async () => {
    setSession({
      data: null,
      error: { status: 500, message: 'session fetch failed' },
      isPending: false,
      isRefetching: false,
    });
    const { result, rerender } = renderHook(() => useSession());
    expect(result.current.isPending).toBe(true);

    // The retry (or any refetch) lands: better-auth clears error and sets data.
    setSession({
      data: { user: { id: 'u1', role: 'user' }, session: { id: 's1' } },
      error: null,
      isPending: false,
      isRefetching: false,
    });
    rerender();

    await waitFor(() =>
      expect(result.current.data).toEqual({
        user: { id: 'u1', role: 'user' },
        session: { id: 's1' },
      }),
    );
    expect(result.current.isPending).toBe(false);
    expect(result.current.isSessionError).toBe(false);
  });

  it('keeps the initial loading state pending until better-auth resolves', () => {
    setSession({ data: null, error: null, isPending: true, isRefetching: false });
    const { result } = renderHook(() => useSession());

    expect(result.current.isPending).toBe(true);
    expect(result.current.isSessionError).toBe(false);
    expect(h.refetch).not.toHaveBeenCalled();
  });

  it('retrySession performs a manual refetch (AuthGate retry button)', () => {
    setSession({
      data: null,
      error: { status: 500, message: 'session fetch failed' },
      isPending: false,
      isRefetching: false,
    });
    const { result } = renderHook(() => useSession());

    act(() => {
      result.current.retrySession();
    });

    expect(h.refetch).toHaveBeenCalledTimes(1);
  });
});
