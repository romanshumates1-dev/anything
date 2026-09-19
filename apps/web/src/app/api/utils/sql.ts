import { neon, NeonQueryFunction } from '@neondatabase/serverless';

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

const sql = (
  process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : NullishQueryFunction
) as SqlQueryFunction;
sql.query = sql;

/**
 * UNSAFE: Injects raw SQL without parameterization.
 * Only use for dynamic column/table names, never for user input.
 */
sql.unsafe = (rawSql: string) => ({ __unsafeSql: rawSql });

export default sql;
