import {
  neon,
  neonConfig,
  NeonQueryFunction,
  type NeonQueryPromise,
} from '@neondatabase/serverless';
import { isCloudflareWorkers } from '@/lib/websocket';

import { runWithDbRetry } from './dbRetry';

/**
 * ⚠ WORKERS TRANSPORT — same cross-request I/O defect as lib/auth.ts (2026-10-01)
 * -------------------------------------------------------------------------
 * `neon()` returns a tagged-template function bound to a WebSocket transport
 * by default. On Cloudflare Workers a WebSocket is an I/O object owned by the
 * request that opened it, and this module binds `base` once at module scope.
 * Every later request that reuses `base` therefore touches a previous request's
 * socket and workerd throws:
 *
 *   "Cannot perform I/O on behalf of a different request"
 *
 * followed by the runtime cancelling the request as hung. Measured in
 * production, that is 12 authenticated routes returning HTTP 500 while
 * `next start` served them fine — the exact "Worker exceeded resource limits"
 * symptom. `poolQueryViaFetch` makes the driver use per-query HTTP requests
 * instead, so there is no retained socket to cross a request boundary.
 *
 * Node is left on the WebSocket path deliberately: it is faster there and has
 * no per-request I/O restriction, so changing it would be an unmeasured change
 * to a path that demonstrably works.
 */
if (isCloudflareWorkers()) {
  neonConfig.poolQueryViaFetch = true;
}

type SqlQueryFunction = NeonQueryFunction<false, false> & {
  query: NeonQueryFunction<false, false>;
  /**
   * UNSAFE: Injects raw SQL without parameterization.
   * Only use for dynamic column/table names, never for user input.
   */
  unsafe: (sql: string) => { __unsafeSql: string };
};

/**
 * A tagged-template query: lazy, and never executed until awaited or handed to
 * `sql.transaction([...])`. The driver's `transaction()` only accepts queries
 * typed with its default `false, false` generics, so `ReturnType<typeof sql>`
 * (which widens the generics to `boolean, boolean`) must NOT be used for the
 * statements of a batch - it fails to compile and, before that, the widened
 * type described nothing real.
 */
export type SqlQuery = NeonQueryPromise<false, false>;

const NullishQueryFunction = (() => {
  throw new Error(
    'No database connection string was provided to `neon()`. Perhaps process.env.DATABASE_URL has not been set'
  );
}) as any as SqlQueryFunction;

NullishQueryFunction.transaction = (() => {
  throw new Error(
    'No database connection string was provided to `neon()`. Perhaps process.env.DATABASE_URL has not been set'
  );
}) as any as NeonQueryFunction<false, false>['transaction'];
NullishQueryFunction.query = NullishQueryFunction;

const base = (
  process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : NullishQueryFunction
) as SqlQueryFunction;

/**
 * ⚠ THIS DRIVER HAS NO NESTED-FRAGMENT SUPPORT (defect #32).
 *
 * `@neondatabase/serverless` in the pinned version turns EVERY template
 * interpolation into a positional `$n` parameter — there is no branch that
 * splices a previously-built query. So this never worked and silently does the
 * wrong thing:
 *
 *     const where = sql`a = ${x}`;
 *     sql`SELECT ... WHERE ${where}`;   // -> $1 is a JSON blob, not SQL
 *
 * which Postgres rejects with e.g.
 *   invalid input syntax for type boolean: "{"parameterizedQuery":{...}}"
 *
 * To build a dynamic WHERE clause, pass text + params to the string form
 * (`sql(text, params)`), which this driver does support, exactly as
 * `lead-finder/public-pool` already does. `sqlFragmentCompositionGuard.test.ts`
 * fails the build if the broken pattern is reintroduced.
 */

/**
 * TAG-PRESERVING RETRY WRAPPER.
 *
 * WHY THE SHAPE MATTERS, NOT JUST THE RETRY
 * -----------------------------------------
 * The Neon driver's `transaction()` validates every element BEFORE it does any
 * network work:
 *
 *     A.forEach(k => { if (k[Symbol.toStringTag] !== 'NeonQueryPromise')
 *                        throw new Error(...) })
 *
 * An `async` function ALWAYS returns a native Promise, which is tagged
 * "Promise". The previous implementation wrapped this module's tagged template
 * in an `async` function, so `sql.transaction([sql`...`])` threw
 * "transaction() expects an array of queries, or a function returning an array
 * of queries" at EVERY call site -- 11 of them, including /api/dashboard/stats,
 * /api/deals/complete and /api/esign/webhook.
 *
 * It went unnoticed because 116 test files mock this module wholesale, so no
 * test ever executed the driver's validation. It was proven by running the real
 * driver against the real database:
 *
 *     [1] element Symbol.toStringTag = "Promise"  (driver requires "NeonQueryPromise")
 *     [2] sql.transaction([...])     = THREW -> transaction() expects an array of queries...
 *     [3] sequential statements      = OK -> [[{"one":1}],[{"two":2}]]
 *
 * Returning an object that keeps BOTH the driver's tag and its
 * `parameterizedQuery` restores `transaction()` while preserving:
 *
 *  - LAZINESS. The driver reads only `parameterizedQuery`/`opts` and never
 *    awaits the elements it is handed, so nothing fires twice and a batch costs
 *    one round trip.
 *  - RETRY on the awaited path. `runWithDbRetry` re-awaiting the underlying
 *    query promise re-executes it (the driver's `then` calls `execute` afresh),
 *    so a transient connection blip is still retried exactly as before.
 *  - NO RETRY inside a transaction, which stays deliberate: re-running a
 *    partially committed batch is unsafe.
 */
function createRetryingQuery(promise: any): any {
  const run = () => runWithDbRetry(() => promise as Promise<unknown>);
  return {
    [Symbol.toStringTag]: 'NeonQueryPromise',
    parameterizedQuery: promise?.parameterizedQuery,
    opts: promise?.opts,
    then: (onFulfilled?: any, onRejected?: any) => run().then(onFulfilled, onRejected),
    catch: (onRejected?: any) => run().catch(onRejected),
    finally: (onFinally?: any) => run().finally(onFinally),
  };
}

/**
 * Every tagged-template query (`sql`...`) runs through a strictly bounded
 * retry for transient connection-class errors only (see ./dbRetry). This covers
 * the middleware session lookup and all route-level queries. Non-transient
 * errors (syntax, unique violations, permission denied) are rethrown
 * immediately -- no behavior change for real query bugs.
 */
const sql = ((...args: unknown[]) => {
  const promise = (base as unknown as (...a: unknown[]) => any)(...args);
  // Non-query call forms fall through untouched.
  if (!promise || typeof promise.then !== 'function') return promise;
  return createRetryingQuery(promise);
}) as unknown as SqlQueryFunction;
sql.query = sql;

/**
 * Transactions are deliberately NOT retried: re-running a partially
 * committed transaction body is unsafe. Passthrough, unchanged semantics.
 */
sql.transaction = base.transaction;

/**
 * UNSAFE: Injects raw SQL without parameterization.
 * Only use for dynamic column/table names, never for user input.
 */
sql.unsafe = (rawSql: string) => ({ __unsafeSql: rawSql });

export default sql;
