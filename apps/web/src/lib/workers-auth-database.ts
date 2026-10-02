/**
 * A pg-shaped pool backed by Neon's HTTP driver, for Cloudflare Workers.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS (root cause of the production 500s)
 * ---------------------------------------------------------------------------
 * On workerd every I/O object belongs to the request that created it. The
 * module-scope `new Pool(...)` in `auth.ts` opens a WebSocket while serving
 * request A; request B then reuses that same socket, which workerd refuses:
 *
 *   Error: Cannot perform I/O on behalf of a different request.
 *   Error: The Workers runtime canceled this request because it detected that
 *          your Worker's code had hung and would never generate a response.
 *
 * The second line is the "Worker exceeded resource limits" symptom users see.
 * Node imposes no such rule, which is why no local gate ever caught this.
 *
 * Two earlier attempts failed and are recorded so they are not repeated:
 *
 *   1. `neonConfig.poolQueryViaFetch = true` (eca7071) - CANNOT work.
 *      `NeonPool.query` short-circuits to the WebSocket whenever
 *      `hasFetchUnsupportedListeners` is set, and that flag is latched true by
 *      ANY `.on(event, ...)` subscription on the pool. better-auth subscribes
 *      to pool events, so the flag is set and the HTTP path is skipped
 *      regardless of the setting. There is no API to clear the flag.
 *
 *   2. `database = { query }` (acc5277) - CANNOT work.
 *      better-auth runs the value through `createKyselyAdapter`, which
 *      requires a recognised DIALECT. A plain object yields no kysely and it
 *      throws "Failed to initialize database adapter" -> signup 500.
 *
 * This module supplies the shape both libraries actually require, verified by
 * reading the installed source:
 *
 *   @better-auth/kysely-adapter: `if ("connect" in db) dialect = new
 *     PostgresDialect({ pool: db })`, and `getKyselyDatabaseType()` returns
 *     "postgres" for the same key.
 *
 *   kysely postgres-driver: `await pool.connect()`, then
 *     `client.query(sql, params)` destructured as `{ command, rowCount, rows }`,
 *     plus `release()`.
 *
 * Every query becomes a self-contained HTTP request created and consumed inside
 * the request that issued it, so there is no cross-request I/O object at all.
 */

/** pg-style result, as destructured by Kysely's PostgresConnection. */
export interface PgQueryResult<Row = Record<string, unknown>> {
  command: string;
  rowCount: number;
  rows: Row[];
}

/** pg-style client, as held by Kysely's PostgresConnection. */
export interface PgClientLike {
  query<Row = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[]
  ): Promise<PgQueryResult<Row>>;
  release(): void;
}

/**
 * The HTTP query function. Typed structurally so tests can pass a fake, and so
 * this module does not import @neondatabase/serverless at module scope (which
 * would drag the WebSocket path into the Workers bundle).
 */
export interface HttpQueryFn {
  <Row = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[]
  ): Promise<{ rows?: Row[]; rowCount?: number; command?: string }>;
}

const TRANSACTION_CONTROL = /^\s*(begin|start\s+transaction|commit|rollback)\b/i;

/** Statements that carry no result rows but must still resolve cleanly. */
const isControl = (text: string) => TRANSACTION_CONTROL.test(text);

/**
 * Builds the pg-shaped pool.
 *
 * @param httpQuery Neon HTTP query function (`neon(url).query`).
 * @param onQuery   Optional hook, used to apply the shared transient-error
 *                  retry that already protects the Node path in
 *                  `utils/sql.ts`. Injected rather than imported so this module
 *                  stays free of app-level dependencies and is unit-testable.
 */
export function createWorkersAuthDatabase(
  httpQueryOrDriver: HttpQueryFn | { query: HttpQueryFn },
  onQuery?: <T>(run: () => Promise<T>) => Promise<T>
) {
  // Accepts either Neon's `neon(url)` tagged function or its `.query()` form,
  // so the call site does not have to care which one is in play.
  const httpQuery: HttpQueryFn =
    typeof httpQueryOrDriver === 'function'
      ? httpQueryOrDriver
      : (httpQueryOrDriver as { query: HttpQueryFn }).query;

  const run = <T>(fn: () => Promise<T>): Promise<T> =>
    onQuery ? onQuery(fn) : fn();

  const exec = async <Row>(
    text: string,
    params?: readonly unknown[]
  ): Promise<PgQueryResult<Row>> => {
    // Kysely issues `begin`/`commit` as real statements. Neon's HTTP driver
    // executes every query in its own implicit transaction, so these are
    // accepted as no-ops rather than forwarded (Postgres would reject a bare
    // `begin` over the HTTP protocol with no session to attach it to).
    //
    // LIMITATION, stated plainly: a better-auth `db.transaction()` block is
    // therefore NOT atomic on Workers. See PRODUCTION-HARDENING-MASTER-STATUS
    // item C9. Atomicity is restored on the Node path, which uses the real
    // pooled WebSocket and is unaffected.
    if (isControl(text)) {
      return { command: '', rowCount: 0, rows: [] };
    }

    const result = await run(() => httpQuery<Row>(text, params));

    return {
      // Kysely compares `command` to uppercase literals, so normalise.
      command: typeof result?.command === 'string' ? result.command : '',
      rowCount: typeof result?.rowCount === 'number' ? result.rowCount : 0,
      rows: Array.isArray(result?.rows) ? result.rows : [],
    };
  };

  return {
    /** Kysely: `await pool.connect()` -> PostgresConnection. */
    async connect(): Promise<PgClientLike> {
      return {
        query: (text: string, params?: readonly unknown[]) =>
          exec(text, params),
        release() {
          // Nothing is retained between statements: each HTTP request is
          // created and consumed within the caller's own request.
        },
      };
    },

    /** Direct pool-level query (better-auth's own `pool.query` retry path). */
    query: (text: string, params?: readonly unknown[]) => exec(text, params),

    /** Read by Kysely when constructing PostgresConnection. */
    options: {},
  };
}