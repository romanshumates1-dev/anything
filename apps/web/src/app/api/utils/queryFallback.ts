/**
 * Make a swallowed error visible without changing control flow.
 *
 * A bare `.catch(() => [])` turns a failed query into "no data", which is
 * indistinguishable from a genuinely empty result. That is how defects #46,
 * #47 and the duplicates route hid: the endpoint answered 200 with an empty
 * payload and nobody investigated, because nothing looked broken.
 *
 * `fallback` keeps the caller's existing behaviour EXACTLY as it was - this is
 * an observability change, not a behaviour change, so it is safe to apply
 * across a file without re-testing every path. The error is logged with a
 * caller-supplied label so the source is identifiable in the logs.
 *
 * Decide deliberately which direction each caller fails in. Failing toward an
 * empty result is right for a chart or a list; failing toward zero is right for
 * a counter. Neither is right for anything that gates an action.
 *
 * Enforced by src/app/api/__tests__/security/swallowed-error.guard.test.ts.
 */
export function logFallback<T>(label: string, fallback: T) {
  return (error: unknown): T => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[query-fallback] ${label} failed, using fallback:`, message);
    return fallback;
  };
}
