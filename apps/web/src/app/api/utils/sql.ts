import { neon, NeonQueryFunction } from '@neondatabase/serverless';

import { runWithDbRetry } from './dbRetry';

type SqlQueryFunction = NeonQueryFunction<false, false> & {
  query: NeonQueryFunction<false, false>;
  /**
   * UNSAFE: Injects raw SQL without parameterization.
   * Only use for dynamic column/table names, never for user input.
   */
  unsafe: (sql: string) => { __unsafeSql: string };
};

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
 * RANDOM SIGN-OUT FIX: every tagged-template query (`sql`...`) now runs
 * through a strictly bounded retry for transient connection-class errors
 * only (see ./dbRetry). This covers the middleware session lookup and all
 * route-level queries. Non-transient errors (syntax, unique violations,
 * permission denied) are rethrown immediately — no behavior change for
 * real query bugs.
 */
const sql = (async (...args: unknown[]) => {
  return runWithDbRetry(() =>
    (base as unknown as (...a: unknown[]) => Promise<unknown>)(...args)
  );
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
