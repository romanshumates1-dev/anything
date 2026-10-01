/**
 * RATE-LIMIT BYPASS ATTEMPT — executed, not reasoned from code review.
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 * Session 7 recorded the rate-limit work as "limits are enforced and 429s are
 * observed, but no BYPASS ATTEMPT was made". Every IP-keyed control in this app
 * (contact form, portal offer/closing, review submission, and the 5/hour
 * `reset-password` anti-brute-force bucket) depends on two things holding at
 * once:
 *
 *   1. the caller cannot choose which bucket they land in, and
 *   2. the counter cannot be raced below the truth.
 *
 * Both are exercised here against a REAL Postgres engine (PGlite), because a
 * mocked `sql` accepts whatever the implementation says and therefore cannot
 * falsify either property. The function under test is `rateLimitByUser` itself
 * - the exact SQL that ships - and the identifier is derived by the production
 * `rateLimitIdentifier`, so this is the real composition, not a re-write of it.
 *
 * THE FOUR ATTEMPTS
 * -----------------
 *   A. Header rotation - forge a fresh `x-forwarded-for` leftmost entry on
 *      every request (the classic bypass) and show all of them resolve to ONE
 *      bucket, so the Nth request is still denied.
 *   B. Header stripping - withhold every forwarding header and show the caller
 *      is denied (fail closed) and creates no row, instead of receiving an
 *      unlimited bucket.
 *   C. Burst - fire a concurrent burst larger than the limit and require the
 *      number of ALLOWED requests to equal the limit EXACTLY. A lost update (a
 *      read-then-write counter) shows up here as more allowed than the limit.
 *   D. Bucket independence - exhausting one action/IP must not spend another's
 *      budget (a limiter that under-keys is a self-denial-of-service; one that
 *      shares keys is a bypass).
 *
 * Window semantics: fixed windows intentionally permit up to ~2x the limit
 * across a boundary (documented on the implementation).
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { rateLimitIdentifier } from '@/app/api/utils/clientIp';

let db: any;

/**
 * sql`` tag backed by PGlite. Values stay bound parameters, so the production
 * statement (including its `${...}` placeholders) runs verbatim.
 */
const sqlQuery = async (strings: unknown, ...values: unknown[]) => {
  const parts: string[] = Array.isArray(strings) ? (strings as string[]) : [String(strings)];
  const isTagged = Array.isArray(strings);

  let text = '';
  parts.forEach((s, i) => {
    text += s;
    if (isTagged && i < values.length) text += `$${i + 1}`;
  });
  if (!text.trim()) throw new Error('sqlQuery called with an empty query');

  const res = await db.query(text, values as any[]);
  const rows = res?.rows;
  return Array.isArray(rows) ? rows : await Array.from(rows ?? []);
};

vi.mock('@/app/api/utils/sql', () => ({ default: sqlQuery }));

// Imported AFTER the mock so the module binds the PGlite-backed tag.
const { rateLimitByUser } = await import('@/app/api/utils/rateLimit');

/** The forwarding chain a real edge produces: forged leftmost, proxy rightmost. */
const PROXY_APPENDED = '203.0.113.9';

function reqWithForwardedFor(forwarded: string | null): Request {
  const headers = new Headers();
  if (forwarded !== null) headers.set('x-forwarded-for', forwarded);
  return new Request('https://example.test/api/contact', { headers });
}

async function countRows(identifier: string, action: string): Promise<number> {
  const res = await db.query(
    `SELECT count AS c FROM rate_limits WHERE identifier = $1 AND action = $2`,
    [identifier, action]
  );
  const list = Array.isArray(res?.rows) ? res.rows : await Array.from(res?.rows ?? []);
  return list.length === 0 ? 0 : Number((list[0] as any).c);
}

beforeAll(async () => {
  db = new PGlite();
  await db.waitReady;
  // Migration 041 verbatim: the primary key IS the protection, so the test
  // creates the real constraint rather than a convenient stand-in.
  await db.exec(`
    CREATE TABLE rate_limits (
      identifier    text        NOT NULL,
      action        text        NOT NULL,
      window_start  timestamptz NOT NULL,
      count         integer     NOT NULL DEFAULT 0,
      updated_at    timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (identifier, action, window_start)
    );
    CREATE INDEX idx_rate_limits_window_start ON rate_limits (window_start);
  `);
}, 60_000);

beforeEach(async () => {
  await db.exec('TRUNCATE rate_limits;');
});

describe('A. header rotation cannot pick a bucket', () => {
  it('six forged leftmost addresses collapse to ONE bucket, and the 6th is denied', async () => {
    // Each request forges a DIFFERENT `x-forwarded-for` leftmost entry - the
    // bypass that made the old leftmost-`[0]` read exploitable - while the
    // proxy-appended address stays constant.
    const forged = ['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4', '5.5.5.5', '6.6.6.6'];
    const identifiers = forged.map((f) =>
      rateLimitIdentifier(reqWithForwardedFor(`${f}, ${PROXY_APPENDED}`))
    );

    // Non-vacuous: the forged values really are all different...
    expect(new Set(forged).size).toBe(6);
    // ...and yet every request resolves to the same bucket.
    expect(new Set(identifiers).size).toBe(1);
    expect(identifiers[0]).toBe(PROXY_APPENDED);

    const limit = 5;
    const results = [];
    for (const f of forged) {
      const id = rateLimitIdentifier(reqWithForwardedFor(`${f}, ${PROXY_APPENDED}`));
      results.push(await rateLimitByUser(id, 'contact-form', limit, 3600));
    }

    expect(results.filter((r) => r.allowed)).toHaveLength(limit);
    // The 6th request carried ANOTHER fresh forged header and was still denied.
    const denied = results.filter((r) => !r.allowed);
    expect(denied).toHaveLength(forged.length - limit);
    expect(denied[0].remaining).toBe(0);
    // One row, not six: rotating the header created no extra budget.
    expect(await countRows(PROXY_APPENDED, 'contact-form')).toBe(6);
  });

  it('a forged address is never the bucket key', async () => {
    await rateLimitByUser(
      rateLimitIdentifier(reqWithForwardedFor('1.1.1.1, 203.0.113.9')),
      'contact-form',
      5,
      3600
    );
    for (const forged of ['1.1.1.1', '2.2.2.2']) {
      expect(await countRows(forged, 'contact-form')).toBe(0);
    }
  });
});

describe('B. an unidentified caller fails closed', () => {
  it('no forwarding headers at all -> denied, and no bucket is created', async () => {
    const id = rateLimitIdentifier(reqWithForwardedFor(null));
    expect(id).toBeNull();

    const result = await rateLimitByUser(id, 'reset-password', 5, 3600);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);

    const total = await db.query('SELECT COUNT(*)::int AS n FROM rate_limits');
    const rows = Array.isArray(total?.rows) ? total.rows : await Array.from(total?.rows ?? []);
    expect(Number((rows[0] as any).n)).toBe(0);
  });

  it('a header that is not an address (injection attempt) is treated as unidentified', async () => {
    for (const junk of [
      "'; DROP TABLE rate_limits;--",
      '<script>alert(1)</script>',
      'not-an-ip',
      '999.1.1.1',
    ]) {
      const id = rateLimitIdentifier(reqWithForwardedFor(junk));
      expect(id).toBeNull();
      const result = await rateLimitByUser(id, 'reset-password', 5, 3600);
      expect(result.allowed).toBe(false);
    }
    // The table still exists and holds nothing.
    expect(await countRows('999.1.1.1', 'reset-password')).toBe(0);
  });
});

describe('C. a concurrent burst cannot exceed the limit (no lost update)', () => {
  it('30 parallel calls at limit 5 -> exactly 5 allowed, 25 denied', async () => {
    const limit = 5;
    const burst = 30;
    const results = await Promise.all(
      Array.from({ length: burst }, () =>
        rateLimitByUser(PROXY_APPENDED, 'portal-offer', limit, 3600)
      )
    );

    const allowed = results.filter((r) => r.allowed).length;
    // Exactly, not "at most": fewer would mean the counter double-counts one
    // request, which denies legitimate traffic.
    expect(allowed).toBe(limit);
    expect(await countRows(PROXY_APPENDED, 'portal-offer')).toBe(burst);

    // Each allowed request observed a DISTINCT count (5, 4, 3, 2, 1 remaining).
    // A read-then-write counter hands several callers the same number.
    const remainingWhenAllowed = results.filter((r) => r.allowed).map((r) => r.remaining);
    expect(new Set(remainingWhenAllowed).size).toBe(limit);
  }, 30_000);
});

describe('D. buckets are independent per (identifier, action)', () => {
  it('exhausting reset-password for one IP leaves other actions and IPs untouched', async () => {
    const limit = 3;
    for (let i = 0; i < limit + 1; i++) {
      await rateLimitByUser('198.51.100.7', 'reset-password', limit, 3600);
    }
    expect((await rateLimitByUser('198.51.100.7', 'reset-password', limit, 3600)).allowed).toBe(
      false
    );

    // Same IP, different action -> independent budget (no self-denial-of-service).
    expect((await rateLimitByUser('198.51.100.7', 'contact-form', limit, 3600)).allowed).toBe(true);
    // Same action, different IP -> independent budget.
    expect((await rateLimitByUser('198.51.100.8', 'reset-password', limit, 3600)).allowed).toBe(
      true
    );
  });
});
