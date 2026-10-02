/**
 * WHY THIS TEST EXISTS
 * ---------------------------------------------------------------------------
 * Two fixes for the Cloudflare Workers 500s were deployed and BOTH failed:
 *
 *   eca7071  `neonConfig.poolQueryViaFetch = true`  -> still 12 x HTTP 500.
 *   acc5277  `database = { query }` on Workers       -> signup 500, because
 *            better-auth needs a Kysely DIALECT and threw
 *            "Failed to initialize database adapter".
 *
 * Both shipped as guesses at library internals. This file pins the contract
 * that the third attempt must satisfy, so the next guess fails HERE first
 * instead of in production.
 *
 * The contract was READ, not assumed, from the installed dependencies:
 *
 *   @better-auth/kysely-adapter/dist/index.mjs
 *     getKyselyDatabaseType():  `if ("connect" in db) return "postgres"`.
 *     createKyselyAdapter():    `if ("connect" in db) dialect = new
 *                                PostgresDialect({ pool: db })`.
 *     Anything lacking a recognised key yields no dialect at all and
 *     better-auth throws "Failed to initialize database adapter".
 *
 *   kysely/dist/dialect/postgres/postgres-driver.js
 *     acquireConnection():  `await this.#pool.connect()`, then wraps the client
 *                           in PostgresConnection, reading `pool.Client` and
 *                           `pool.options`.
 *     PostgresConnection.executeQuery():
 *                           `await this.#client.query(sql, parameters)` and
 *                           destructures `{ command, rowCount, rows }`.
 *     Transactions:         `begin` / `savepoint` / `commit` / `rollback` are
 *                           issued as ordinary SQL through that same client.
 *
 * So the Workers database must be a pg-shaped pool backed by Neon's HTTP
 * driver, NOT a raw `{ query }` object.
 */
import { describe, expect, it } from 'vitest';
import { createWorkersAuthDatabase } from '../workers-auth-database';

/** Minimal pg-shaped pool shape, as consumed by Kysely's postgres driver. */
interface FakePgPool {
  connect(): Promise<unknown>;
  query(text: string, params?: readonly unknown[]): Promise<unknown>;
  Client?: unknown;
  options?: unknown;
}

describe('createWorkersAuthDatabase — better-auth / Kysely contract', () => {
  const fakeResult = { command: 'SELECT', rowCount: 0, rows: [] };

  const capture = () => {
    const calls: Array<{ text: string; params?: readonly unknown[] }> = [];
    const sql = async (text: string, params?: readonly unknown[]) => {
      calls.push({ text, params });
      return fakeResult;
    };
    return { calls, sql };
  };

  it('exposes `connect` so better-auth classifies it as a postgres dialect', () => {
    const { sql } = capture();
    const db = createWorkersAuthDatabase({ query: sql });

    // This single key is what routes better-auth into PostgresDialect.
    expect('connect' in db).toBe(true);
  });

  it('satisfies the exact "createKyselyAdapter" dispatch conditions', () => {
    const { sql } = capture();
    const db = createWorkersAuthDatabase({ query: sql });

    // Mirrors getKyselyDatabaseType()'s postgres branch.
    const databaseType = 'connect' in db ? 'postgres' : null;
    expect(databaseType).toBe('postgres');

    // No other branch may claim this object first, or better-auth builds the
    // wrong dialect (sqlite/mysql) and queries fail at runtime.
    expect('createDriver' in db).toBe(false);
    expect('aggregate' in db).toBe(false);
    expect('getConnection' in db).toBe(false);
    expect('fileControl' in db).toBe(false);
    expect('createSession' in db).toBe(false);
  });
  it('returns a client whose query() yields pg-shaped {command,rowCount,rows}', async () => {
    const { sql, calls } = capture();
    const db = createWorkersAuthDatabase({ query: sql });

    const client = (await (db as FakePgPool).connect()) as {
      query(text: string, params?: readonly unknown[]): Promise<unknown>;
      release(): void;
    };
    const result = (await client.query('select 1 as n')) as {
      command?: string;
      rowCount?: number;
      rows?: unknown[];
    };

    // Kysely destructures exactly these three fields.
    expect(result).toHaveProperty('rows');
    expect(result).toHaveProperty('rowCount');
    expect(result).toHaveProperty('command');
    expect(Array.isArray(result.rows)).toBe(true);

    expect(calls[0]?.text).toContain('select 1');
  });

  it('passes SQL and parameters through verbatim to the HTTP driver', async () => {
    const { sql, calls } = capture();
    const db = createWorkersAuthDatabase({ query: sql });
    const client = (await (db as FakePgPool).connect()) as {
      query(text: string, params?: readonly unknown[]): Promise<unknown>;
    };

    await client.query('select * from "user" where id = $1', ['abc']);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toBe('select * from "user" where id = $1');
    expect(calls[0]?.params).toEqual(['abc']);
  });

  it('swallows transaction control statements but forwards the DML in order', async () => {
    const { sql, calls } = capture();
    const db = createWorkersAuthDatabase({ query: sql });

    const client = (await (db as FakePgPool).connect()) as {
      query(text: string, params?: readonly unknown[]): Promise<unknown>;
      release(): void;
    };

    await client.query('begin');
    await client.query('insert into "user" (id) values ($1)', ['u1']);
    await client.query('commit');

    // Neon's HTTP driver runs every request in its OWN implicit transaction,
    // so a bare `begin`/`commit` has no session to attach to and would be
    // rejected by Postgres. They are accepted as no-ops instead: control
    // statements are NOT forwarded to the driver.
    expect(calls.map((c) => c.text.toLowerCase())).not.toContain('begin');
    expect(calls.map((c) => c.text.toLowerCase())).not.toContain('commit');

    // The actual work still reaches the database, in order.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain('insert into');
    expect(calls[0]?.params).toEqual(['u1']);
  });

  it('still fails loudly on a real SQL error rather than swallowing it', async () => {
    // Guards against the control-statement shortcut masking genuine failures.
    const sql = async () => {
      throw new Error('permission denied for table user');
    };
    const db = createWorkersAuthDatabase({ query: sql });
    const client = (await (db as FakePgPool).connect()) as {
      query(): Promise<unknown>;
    };

    await expect(client.query('select 1')).rejects.toThrow(/permission denied/);
  });

  it('supports Kysely savepoint statements without throwing', async () => {
    const { sql } = capture();
    const db = createWorkersAuthDatabase({ query: sql });
    const client = (await (db as FakePgPool).connect()) as {
      query(text: string): Promise<unknown>;
    };

    await expect(client.query('savepoint sp1')).resolves.toBeTruthy();
    await expect(client.query('rollback to savepoint sp1')).resolves.toBeTruthy();
    await expect(client.query('release savepoint sp1')).resolves.toBeTruthy();
  });

  it('exposes `release()` so Kysely can free the connection', async () => {
    const { sql } = capture();
    const db = createWorkersAuthDatabase({ query: sql });
    const client = (await (db as FakePgPool).connect()) as {
      release(): void;
    };
    expect(() => client.release()).not.toThrow();
  });

  it('normalises a missing command to a string (Kysely compares to uppercase)', async () => {
    const sql = async () => ({ rows: [], rowCount: 0 }) as unknown;
    const db = createWorkersAuthDatabase({ query: sql });
    const client = (await (db as FakePgPool).connect()) as {
      query(): Promise<{ command: string }>;
    };
    const r = await client.query();
    expect(typeof r.command).toBe('string');
  });

  /**
   * REGRESSION — production signup 400 FAILED_TO_CREATE_USER (2026-10-01).
   *
   * `neon(url)` in DEFAULT mode (no `fullResults: true`) resolves an ordinary
   * `sql(text, params)` call to a bare rows ARRAY — `[{ id: 'u1', ... }]` — not
   * a `{ command, rowCount, rows }` object. The adapter read `result?.rows` on
   * that array, got `undefined`, and normalised to `[]`.
   *
   * better-auth creates users via `.insertInto('user').values(...).returningAll()
   * .executeTakeFirst()` (verified in @better-auth/kysely-adapter/dist/index.mjs
   * line 362/501): an INSERT...RETURNING whose rows come back empty yields
   * `undefined`, and sign-up.mjs line 224 turns that into
   * `FAILED_TO_CREATE_USER` (HTTP 400) WITHOUT throwing — which is exactly why
   * `wrangler tail` showed a clean 200 with no exception.
   *
   * The insert DID reach the database; only the returned row was dropped. So
   * this test feeds the adapter the exact value the real driver produces and
   * requires the row to survive.
   */
  it('surfaces rows when the HTTP driver resolves to a bare rows array (Neon default mode)', async () => {
    const insertedRow = { id: 'u1', email: 'new@user.example' };
    const sql = async () => [insertedRow] as unknown;
    const db = createWorkersAuthDatabase({ query: sql });
    const client = (await (db as FakePgPool).connect()) as {
      query(): Promise<{ rows: Array<{ id: string }>; command: string; rowCount: number }>;
    };

    const r = await client.query('insert into "user" (...) values (...) returning *');

    // THE BUG: this used to be [] because `result.rows` on an array is undefined.
    expect(r.rows).toEqual([insertedRow]);
    expect(r.rowCount).toBe(1);
    // command is not present on the array form; Kysely needs a string, not undefined.
    expect(typeof r.command).toBe('string');
  });
});