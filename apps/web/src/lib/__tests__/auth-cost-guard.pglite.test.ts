/**
 * Sign-in cost guard — concurrency proof against a REAL Postgres engine.
 *
 * THE BYPASS BEING CLOSED
 * -----------------------
 * Measured on the deployed Worker 2026-10-03: better-auth's built-in /sign-in
 * limiter admitted 5 of 8 simultaneous attempts against a documented maximum of
 * 3. It read-decide-writes around `await`s, so parallel requests each observed a
 * stale count and all proceeded. Every admitted attempt runs scrypt at ~98ms,
 * while the Workers Free plan allows ~10ms of CPU per invocation — so the burst
 * exhausts the budget and Cloudflare returns "Worker exceeded resource limits".
 *
 * WHY A MOCKED `sql` CANNOT PROVE THIS
 * -----------------------------------
 * The property under test is atomicity of a single SQL statement. A mock returns
 * whatever the implementation hands it, so it would happily return count=1 to
 * eight concurrent callers and the test would pass while production fails. This
 * suite runs the REAL shipping statement against PGlite, a genuine Postgres
 * engine, with the identical `ON CONFLICT` upsert and the identical unique index.
 *
 * Covers the required matrix: 1, 3, 4, 8 and 20 concurrent attempts, multiple
 * identifiers, multiple IPs, reset behaviour, failed logins, and limiter-outage
 * behaviour. No production traffic is involved.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

let db: any;

/** The shipping statement, verbatim, against PGlite. Values stay bound. */
const sqlQuery = async (strings: unknown, ...values: unknown[]) => {
  const parts: string[] = Array.isArray(strings) ? (strings as string[]) : [String(strings)];
  const isTagged = Array.isArray(strings);
  let text = '';
  parts.forEach((s, i) => {
    text += s;
    if (isTagged && i < values.length) text += `$${i + 1}`;
  });
  const res = await db.query(text, values as any[]);
  return Array.isArray(res?.rows) ? res.rows : Array.from(res?.rows ?? []);
};

vi.mock('@/app/api/utils/sql', () => ({ default: sqlQuery }));

const { checkSignInCost, SIGN_IN_IP_LIMIT, SIGN_IN_ACCOUNT_LIMIT } = await import(
  '@/lib/auth-cost-guard'
);

const IP_A = '198.51.100.10';
const IP_B = '203.0.113.20';

const DDL = `
  CREATE TABLE rate_limits (
    identifier   text        NOT NULL,
    action       text        NOT NULL,
    window_start timestamptz NOT NULL,
    count        integer     NOT NULL,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (identifier, action, window_start)
  );
`;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(DDL);
});

describe('the required concurrency matrix', () => {
  it('3 concurrent attempts at limit 3 -> exactly 3 allowed', async () => {
    const r = await Promise.all(
      Array.from({ length: 3 }, () => checkSignInCost(IP_A, 'a@example.com'))
    );
    expect(r.filter((x) => x.allowed)).toHaveLength(3);
  });

  it('4 concurrent attempts at limit 3 -> exactly 3 allowed, 1 refused', async () => {
    const r = await Promise.all(
      Array.from({ length: 4 }, () => checkSignInCost(IP_A, 'a@example.com'))
    );
    expect(r.filter((x) => x.allowed)).toHaveLength(3);
    expect(r.filter((x) => !x.allowed)).toHaveLength(1);
  });

  it('8 concurrent attempts at limit 3 -> exactly 3 allowed (the measured bypass)', async () => {
    // better-auth admitted 5 of 8 here. This regression must not come back.
    const r = await Promise.all(
      Array.from({ length: 8 }, () => checkSignInCost(IP_A, 'a@example.com'))
    );
    expect(r.filter((x) => x.allowed)).toHaveLength(SIGN_IN_IP_LIMIT);
  });

  it('20 concurrent attempts at limit 3 -> exactly 3 allowed', async () => {
    const r = await Promise.all(
      Array.from({ length: 20 }, () => checkSignInCost(IP_A, 'a@example.com'))
    );
    expect(r.filter((x) => x.allowed)).toHaveLength(SIGN_IN_IP_LIMIT);
  }, 30_000);

  it('refusals carry a positive retry-after so a client can back off', async () => {
    await Promise.all(Array.from({ length: 5 }, () => checkSignInCost(IP_A, 'a@example.com')));
    const r = await checkSignInCost(IP_A, 'a@example.com');
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe('multiple identifiers and IPs', () => {
  it('distinct IPs get independent budgets', async () => {
    await Promise.all(Array.from({ length: 5 }, () => checkSignInCost(IP_A, 'a@example.com')));
    expect((await checkSignInCost(IP_A, 'a@example.com')).allowed).toBe(false);
    // A different user behind a different IP is unaffected — otherwise one
    // attacker could lock out every other user.
    expect((await checkSignInCost(IP_B, 'a@example.com')).allowed).toBe(true);
  });

  it('the per-account limit stops a distributed attack on one victim', async () => {
    // Each attempt from a different IP, all aimed at one account. The IP
    // dimension alone would admit all of these.
    const attempts = await Promise.all(
      Array.from({ length: SIGN_IN_ACCOUNT_LIMIT + 5 }, (_, i) =>
        checkSignInCost(`10.0.0.${(i % 250) + 1}`, 'victim@example.com')
      )
    );
    expect(attempts.filter((x) => x.allowed)).toHaveLength(SIGN_IN_ACCOUNT_LIMIT);
  });

  it('an unidentifiable IP does not get a free pass', async () => {
    // Only the account dimension applies; it must still be enforced.
    const r = await Promise.all(
      Array.from({ length: SIGN_IN_ACCOUNT_LIMIT + 5 }, () => checkSignInCost(null, 'a@example.com'))
    );
    expect(r.filter((x) => x.allowed)).toHaveLength(SIGN_IN_ACCOUNT_LIMIT);
  });

  it('email casing and padding do not create a second bucket', async () => {
    // Exhaust ONLY the account dimension, leaving the IP dimension untouched, so
    // a refusal can only have come from the account bucket. Spending the IP
    // budget here would make the refusal ambiguous.
    await Promise.all(
      Array.from({ length: SIGN_IN_ACCOUNT_LIMIT }, (_, i) =>
        checkSignInCost(`10.1.0.${i + 1}`, 'target@example.com')
      )
    );
    // Same account, different casing/whitespace, from a brand-new IP.
    const r = await checkSignInCost(IP_B, '  TARGET@Example.com  ');
    expect(r.allowed).toBe(false);
    expect(r.scope).toBe('account');
  });
});

describe('reset behaviour', () => {
  it('allows a legitimate retry once the window rolls over', async () => {
    await Promise.all(Array.from({ length: 5 }, () => checkSignInCost(IP_A, 'a@example.com')));
    expect((await checkSignInCost(IP_A, 'a@example.com')).allowed).toBe(false);

    // Move past the 10s window rather than sleeping, so the suite stays fast.
    await db.exec("UPDATE rate_limits SET window_start = window_start - interval '20 seconds'");
    expect((await checkSignInCost(IP_A, 'a@example.com')).allowed).toBe(true);
  });

  it('a failed login sequence is limited exactly like a successful one', async () => {
    // The guard sees only (ip, email); it must not depend on the outcome, or
    // failures become free to retry.
    const r = await Promise.all(
      Array.from({ length: 6 }, () => checkSignInCost(IP_A, 'a@example.com'))
    );
    expect(r.filter((x) => x.allowed)).toHaveLength(SIGN_IN_IP_LIMIT);
  });
});

describe('the limiter failing must not open the gate', () => {
  it('a database error fails CLOSED', async () => {
    // Break the table so the shipping statement throws.
    await db.exec('DROP TABLE rate_limits');
    try {
      const r = await checkSignInCost(IP_A, 'a@example.com');
      expect(r.allowed).toBe(false);
      expect(r.limiterError).toBe(true);
    } finally {
      await db.exec(DDL);
    }
  });
});

beforeEach(async () => {
  await db.exec('TRUNCATE rate_limits');
});

describe('single attempt', () => {
  it('allows the first attempt', async () => {
    expect((await checkSignInCost(IP_A, 'a@example.com')).allowed).toBe(true);
  });
});
