'use client';

/**
 * User preferences: ONE key, ONE fetcher.
 *
 * THE DEFECT THIS FIXES (measured 2026-10-03, deployed /dashboard)
 * ---------------------------------------------------------------
 * Three components read the same preferences endpoint on every authenticated
 * page load, each with its own request:
 *
 *   Shell                  useQuery(['user-preferences'])  <- had a cache
 *   AccessibilityProvider  raw fetch() inside an effect      <- no cache
 *   OnboardingTutorial     raw fetch(..., {cache:'no-store'})<- no cache
 *
 * The browser measurement showed three requests for `/api/user/preferences`
 * firing in the SAME MILLISECOND (372, 372, 372) plus a fourth at 819ms - three
 * readers, none of them sharing a cache, so React Query's dedupe could not help.
 * Four Worker invocations for one small object, on every page, forever.
 *
 * `Shell.test.tsx` asserts that the Shell does not fetch this endpoint for an
 * anonymous visitor - which it does not - and misses this entirely, because the
 * test mocks `AccessibilityProvider` away. The duplication lived BETWEEN
 * components, so no single component's test could see it. That is the shape of
 * bug a per-component test cannot catch, and the reason this one is guarded by a
 * measurement of the assembled page instead.
 *
 * The fix is the same one that removed the duplicated pipeline fetch: give the
 * payload a single key and have every reader go through the shared cache.
 */
import { useQuery, type QueryClient } from '@tanstack/react-query';

/** Single shared key. Every reader MUST use this, or the dedupe is lost again. */
export const USER_PREFERENCES_QUERY_KEY = ['user-preferences'] as const;

export interface UserPreferencesResponse {
  preferences?: Record<string, unknown>;
}

/**
 * Reads preferences from the server.
 *
 * Returns `null` for any non-2xx rather than throwing: a signed-out visitor
 * gets 401 here, and every reader already treats "no stored preferences" as a
 * valid, non-exceptional outcome.
 */
export async function fetchUserPreferences(): Promise<UserPreferencesResponse | null> {
  const res = await fetch('/api/user/preferences');
  if (!res.ok) return null;
  return (await res.json()) as UserPreferencesResponse;
}

/** Subscription form, for components that render from the value. */
export function useUserPreferences(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: USER_PREFERENCES_QUERY_KEY,
    queryFn: fetchUserPreferences,
    staleTime: 60_000,
    retry: 0,
    enabled: options.enabled,
  });
}

/**
 * One-shot read through the shared cache. Joins an in-flight request instead of
 * starting another one, and serves a fresh cached value rather than re-fetching.
 *
 * Takes the QueryClient explicitly because the callers read from inside an
 * effect or a callback, where a hook may not be called.
 */
export function readUserPreferences(client: QueryClient): Promise<UserPreferencesResponse | null> {
  return client.fetchQuery({
    queryKey: USER_PREFERENCES_QUERY_KEY,
    queryFn: fetchUserPreferences,
    staleTime: 60_000,
  });
}
