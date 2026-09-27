/**
 * RATCHET: `sql` must stay usable inside the Neon driver's `transaction()`.
 *
 * THE DEFECT THIS LOCKS DOWN (found 2026-09-26)
 * ---------------------------------------------
 * `src/app/api/utils/sql.ts` wrapped the Neon tagged template in an `async`
 * function so every statement got a bounded transient-error retry. An `async`
 * function ALWAYS returns a native Promise, tagged "Promise" -- but the driver's
 * `transaction()` refuses anything that is not tagged "NeonQueryPromise":
 *
 *     if (k[Symbol.toStringTag] !== 'NeonQueryPromise') throw new Error(...)
 *
 * The result was that `sql.transaction([...])` threw at all 11 call sites --
 * /api/dashboard/stats, /api/deals/complete, /api/esign/webhook and 8 more --
 * while the whole suite stayed green, because 116 test files mock this module
 * wholesale and so never executed the driver's validation.
 *
 * Proved against the real driver and the real database:
 *     [1] element Symbol.toStringTag = "Promise"  (driver requires "NeonQueryPromise")
 *     [2] sql.transaction([...])     = THREW -> transaction() expects an array of queries
 *     [3] sequential statements      = OK
 *
 * WHAT THIS TEST ASSERTS
 * ----------------------
 * The SHAPE contract the driver depends on, plus the retry contract the wrapper
 * exists for. It deliberately does NOT mock the module under test: mocking is
 * what hid the bug. A deliberately unreachable host is used so no real database
 * is touched -- the driver's element validation is decided before any network
 * call, which is exactly what is being pinned.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

const UNREACHABLE = 'postgres://u:p@127.0.0.1:1/db';

/** Import a FRESH copy of the module AFTER pinning DATABASE_URL. */
async function loadSql() {
  vi.resetModules();
  vi.stubEnv('DATABASE_URL', UNREACHABLE);
  const mod = await import('@/app/api/utils/sql');
  return mod.default as any;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('sql module shape', () => {
  it('a tagged-template query is tagged NeonQueryPromise, as the driver requires', async () => {
    const sql = await loadSql();
    const q = sql`SELECT 1 AS one`;
    // The exact predicate the driver applies to every transaction element.
    expect(q[Symbol.toStringTag]).toBe('NeonQueryPromise');
  });

  it('a tagged-template query still carries the driver parameterizedQuery', async () => {
    const sql = await loadSql();
    const q = sql`SELECT ${1} AS one`;
    // The driver reads `.parameterizedQuery` off every transaction element. If
    // the wrapper dropped it, transaction() would lose the SQL and its params.
    // Real shape from the installed driver: { query, params }.
    expect(q.parameterizedQuery).toBeDefined();
    expect(q.parameterizedQuery.query).toBe('SELECT $1 AS one');
    // The driver stringifies params; what matters is that the value survived
    // and was NOT inlined into the SQL text.
    expect(q.parameterizedQuery.params).toHaveLength(1);
    expect(String(q.parameterizedQuery.params[0])).toBe('1');
  });

  it('transaction() accepts the wrapper output without the element-check error', async () => {
    const sql = await loadSql();
    const batch = [sql`SELECT 1 AS one`, sql`SELECT 2 AS two`];

    // Every element must pass the driver's own check.
    for (const q of batch) {
      expect(q[Symbol.toStringTag]).toBe('NeonQueryPromise');
    }

    let message = '';
    try {
      // Reaches the network only if the element check passed; the host is
      // unreachable, so a TRANSPORT error is the expected outcome.
      await sql.transaction(batch);
    } catch (e: any) {
      message = String(e?.message ?? e);
    }
    // The regression signature: the batch was rejected before any transport.
    expect(message).not.toMatch(/expects an array of queries/i);
    // And it did get as far as attempting transport.
    expect(message.length).toBeGreaterThan(0);
  });

  it('keeps the query thenable, so the retry wrapper stays on the awaited path', async () => {
    const sql = await loadSql();
    const q: any = sql`SELECT 1 AS one`;
    // dbRetry runs when the query is awaited, which requires a real thenable.
    // (Retry classification itself is owned by dbRetry.test.ts -- this file
    // pins the SHAPE contract the driver depends on.)
    expect(typeof q.then).toBe('function');
    expect(typeof q.catch).toBe('function');
    expect(typeof q.finally).toBe('function');
    // Lazy execution: the unreachable host surfaces only on await.
    await expect(q).rejects.toBeDefined();
  }, 15_000);
});
