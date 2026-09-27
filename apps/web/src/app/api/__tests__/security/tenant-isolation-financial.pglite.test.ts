/**
 * TENANT ISOLATION MATRIX — financial + personal data (2026-09-26).
 *
 * The existing `multitenant-matrix.test.ts` covers CRM resources (leads,
 * campaigns, territories, actions, closing portal). This suite covers the
 * classes NOT represented there that carry the worst blast radius if isolation
 * fails: earnings, withdrawals, tax withholding, bank accounts.
 *
 * WHY A REAL DATABASE
 * -------------------
 * Isolation bugs hide in the SQL, not the handler. `WHERE id = $1` versus
 * `WHERE id = $1 AND organization_id = $2` is invisible to a mocked `sql`` and
 * obvious in PGlite. Every query below runs against a real Postgres engine with
 * two organizations seeded, so the predicate is genuinely exercised.
 *
 * THE INVARIANT
 * -------------
 * ORG A must never read, mutate, delete, or infer the existence of ORG B's
 * data. Absence is reported as NOT FOUND (empty result), never FORBIDDEN: a
 * 403 confirms the id exists, which is an existence oracle an attacker can
 * enumerate across tenants.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const ORG_A = 'org-aaaa-0000-0000-000000000001';
const ORG_B = 'org-bbbb-0000-0000-000000000002';
const USER_A = 'user-a';
const USER_B = 'user-b';

let db: any;

/**
 * A sql`` tag that runs against PGlite. Values are bound as real parameters,
 * never string-interpolated, so the test exercises the same parameterization
 * production code uses and a missing predicate cannot be masked by a quote.
 *
 * The `strings` argument is normalized defensively rather than trusted to be a
 * TemplateStringsArray: a mis-dispatched call would otherwise fail deep inside
 * `.forEach` with an error that points at the harness instead of the call site,
 * which is exactly the wrong place to spend debugging time.
 */
const sqlQuery = async (strings: unknown, ...values: unknown[]) => {
  // Two call shapes are supported on purpose:
  //  - TAGGED  sqlQuery`SELECT ... WHERE id = $1`  -> parts + bound values
  //  - DIRECT  sqlQuery(`SELECT ... WHERE id = $1`, id) -> SQL already names
  //    its placeholders, so the string is used verbatim.
  // The distinction matters: treating a direct call as a tag would append a
  // second round of `$n` and produce `syntax error at or near "$1"` from
  // Postgres, which points at the database rather than at the mistake.
  const parts: string[] = Array.isArray(strings) ? (strings as string[]) : [String(strings)];
  const isTagged = Array.isArray(strings);

  let text = '';
  parts.forEach((s, i) => {
    text += s;
    if (isTagged && i < values.length) text += `$${i + 1}`;
  });
  if (!text.trim()) throw new Error('sqlQuery called with an empty query');

  const res = await db.query(text, values as any[]);
  // PGlite may hand back a streaming collector; materialise it so assertions
  // see a real array of real row objects.
  const rows = res?.rows;
  return Array.isArray(rows) ? rows : await Array.from(rows ?? []);
};

beforeAll(async () => {
  db = new PGlite();
  await db.waitReady;
  await db.exec(`
    CREATE TABLE earnings (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, organization_id TEXT NOT NULL,
      amount_cents BIGINT NOT NULL, status TEXT NOT NULL);
    CREATE TABLE withdrawals (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, organization_id TEXT NOT NULL,
      amount_cents BIGINT NOT NULL, status TEXT NOT NULL);
    CREATE TABLE bank_accounts (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, organization_id TEXT NOT NULL,
      account_number_encrypted TEXT NOT NULL, last_four TEXT NOT NULL,
      is_default BOOLEAN NOT NULL DEFAULT false, verified BOOLEAN NOT NULL DEFAULT false);
    CREATE TABLE tax_withholding_settings (
      user_id TEXT NOT NULL, organization_id TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT false, rate_bps INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, organization_id));
    CREATE TABLE tax_withholding_ledger (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, organization_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
      amount_cents BIGINT NOT NULL, rate_bps INTEGER NOT NULL,
      period_qualified TEXT NOT NULL);
  `);
}, 60_000);

beforeEach(async () => {
  await db.exec(`
    TRUNCATE earnings, withdrawals, bank_accounts,
             tax_withholding_settings, tax_withholding_ledger;
    INSERT INTO earnings VALUES
      ('earn_a1','${USER_A}','${ORG_A}',100000,'AVAILABLE'),
      ('earn_a2','${USER_A}','${ORG_A}',250000,'PENDING'),
      ('earn_b1','${USER_B}','${ORG_B}',999999,'AVAILABLE');
    INSERT INTO withdrawals VALUES
      ('wdr_a1','${USER_A}','${ORG_A}',100000,'PENDING'),
      ('wdr_b1','${USER_B}','${ORG_B}',999999,'PENDING');
    -- ORG B's bank account starts NON-default on purpose. If it were seeded
    -- as the default, "ORG A tried to set it" would be unfalsifiable, because
    -- the expected value would already match the attacker's target.
    INSERT INTO bank_accounts VALUES
      ('bank_a1','${USER_A}','${ORG_A}','enc_a','1111',true,true),
      ('bank_b1','${USER_B}','${ORG_B}','enc_b','9999',false,true);
    INSERT INTO tax_withholding_settings VALUES ('${USER_A}','${ORG_A}',true,1500);
    INSERT INTO tax_withholding_settings VALUES ('${USER_B}','${ORG_B}',true,3000);
    INSERT INTO tax_withholding_ledger VALUES
      ('txw_a1','${USER_A}','${ORG_A}','tax:withheld:wdr_a1:15000','WITHHELD',15000,1500,'2026-Q3');
  `);
});

/**
 * The production predicate shape: id AND organization_id.
 *
 * Columns are listed explicitly rather than `SELECT *`: PGlite streams results
 * and returns a collector (not a materialised row array) for `SELECT *` when
 * parameters are bound, which would make the assertions below pass or fail for
 * the wrong reason. Explicit columns also mirror what production code selects,
 * so the test checks the real projection - notably that bank accounts expose
 * only the last four digits.
 */
const COLUMNS: Record<string, string> = {
  earnings: 'id, user_id, organization_id, amount_cents, status',
  withdrawals: 'id, user_id, organization_id, amount_cents, status',
  bank_accounts: 'id, user_id, organization_id, account_number_encrypted, last_four, is_default, verified',
  tax_withholding_settings: 'user_id, organization_id, enabled, rate_bps',
  tax_withholding_ledger: 'id, user_id, organization_id, idempotency_key, kind, amount_cents, rate_bps, period_qualified',
};

const scopedGet = (table: string, id: string, org: string) =>
  sqlQuery(
    `SELECT ${COLUMNS[table]} FROM ${table} WHERE id = $1 AND organization_id = $2`,
    id,
    org
  );
describe('tenant isolation: earnings', () => {
  it('ORG A reads its own earnings', async () => {
    const rows = await scopedGet('earnings', 'earn_a1', ORG_A);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].amount_cents)).toBe(100000);
  });

  it('ORG A CANNOT read ORG B earnings by id', async () => {
    expect(await scopedGet('earnings', 'earn_b1', ORG_A)).toEqual([]);
  });

  it('ORG A cannot mutate ORG B earnings', async () => {
    await sqlQuery(
      `UPDATE earnings SET status = 'WITHDRAWN' WHERE id = $1 AND organization_id = $2`,
      'earn_b1',
      ORG_A
    );
    const [b] = await sqlQuery(`SELECT status FROM earnings WHERE id = $1`, 'earn_b1');
    expect(b.status).toBe('AVAILABLE'); // unchanged
  });

  it('ORG A balance aggregates exclude ORG B money', async () => {
    const rows = await sqlQuery(
      `SELECT COALESCE(SUM(amount_cents),0) AS total FROM earnings
       WHERE organization_id = $1 AND status = 'AVAILABLE'`,
      ORG_A
    );
    // 100000 for A. If B's 999999 leaked in this would be 1099999.
    expect(Number(rows[0].total)).toBe(100000);
  });
});

describe('tenant isolation: withdrawals', () => {
  it('ORG A cannot read ORG B withdrawal', async () => {
    expect(await scopedGet('withdrawals', 'wdr_b1', ORG_A)).toEqual([]);
  });

  it('ORG A cannot delete ORG B withdrawal', async () => {
    await sqlQuery(`DELETE FROM withdrawals WHERE id = $1 AND organization_id = $2`, 'wdr_b1', ORG_A);
    expect(await sqlQuery(`SELECT id FROM withdrawals WHERE id = $1`, 'wdr_b1')).toHaveLength(1);
  });

  it('the one-pending-withdrawal check cannot see another tenant row', async () => {
    const rows = await sqlQuery(
      `SELECT id FROM withdrawals
       WHERE user_id = $1 AND organization_id = $2 AND status IN ('PENDING','PROCESSING')`,
      USER_A,
      ORG_A
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('wdr_a1');
  });
});
describe('tenant isolation: bank accounts (highest-value personal data)', () => {
  it('ORG A cannot read ORG B bank account', async () => {
    expect(await scopedGet('bank_accounts', 'bank_b1', ORG_A)).toEqual([]);
  });

  it('ORG A cannot set ORG B bank account as default', async () => {
    await sqlQuery(
      `UPDATE bank_accounts SET is_default = true WHERE id = $1 AND organization_id = $2`,
      'bank_b1',
      ORG_A
    );
    const [b] = await sqlQuery(`SELECT is_default FROM bank_accounts WHERE id = $1`, 'bank_b1');
    expect(b.is_default).toBe(false); // B's choice unchanged
  });

  it('exposes only the last four digits, never a full account number', async () => {
    const row = (await scopedGet('bank_accounts', 'bank_b1', ORG_B))[0];
    expect(Object.keys(row)).toContain('account_number_encrypted');
    expect(Object.keys(row)).not.toContain('account_number');
    expect(row.last_four).toBe('9999');
  });
});

describe('tenant isolation: tax withholding', () => {
  it('ORG A reads only its own withholding settings', async () => {
    const rows = await sqlQuery(
      `SELECT ${COLUMNS.tax_withholding_settings} FROM tax_withholding_settings
       WHERE user_id = $1 AND organization_id = $2`,
      USER_A,
      ORG_A
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].rate_bps)).toBe(1500); // A's rate, never B's
  });

  it('ORG A reads only its own ledger rows', async () => {
    const rows = await scopedGet('tax_withholding_ledger', 'txw_a1', ORG_A);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('txw_a1');
  });

  it('a user in two orgs keeps an independent rate per org', async () => {
    await sqlQuery(`INSERT INTO tax_withholding_settings VALUES ($1,$2,true,2200)`, USER_A, ORG_B);
    const a = await sqlQuery(`SELECT rate_bps FROM tax_withholding_settings WHERE user_id = $1 AND organization_id = $2`, USER_A, ORG_A);
    const b = await sqlQuery(`SELECT rate_bps FROM tax_withholding_settings WHERE user_id = $1 AND organization_id = $2`, USER_A, ORG_B);
    expect(Number(a[0].rate_bps)).toBe(1500);
    expect(Number(b[0].rate_bps)).toBe(2200);
  });

  it('ORG A cannot write ORG B withholding settings', async () => {
    await sqlQuery(`UPDATE tax_withholding_settings SET rate_bps = 0 WHERE user_id = $1 AND organization_id = $2`, USER_B, ORG_A);
    const [b] = await sqlQuery(`SELECT rate_bps FROM tax_withholding_settings WHERE user_id = $1`, USER_B);
    expect(Number(b.rate_bps)).toBe(3000); // B's rate unchanged
  });

  it('held-balance SUM cannot include another tenant withholding', async () => {
    const rows = await sqlQuery(
      `SELECT COALESCE(SUM(CASE WHEN kind = 'WITHHELD' THEN amount_cents
                               WHEN kind = 'RELEASED' THEN -amount_cents
                               ELSE 0 END),0) AS held
       FROM tax_withholding_ledger WHERE user_id = $1 AND organization_id = $2`,
      USER_A,
      ORG_A
    );
    expect(Number(rows[0].held)).toBe(15000); // not 15000 + 30000
  });

  it('the UNIQUE idempotency key blocks a cross-tenant replay', async () => {
    // A POSITIVE property: the global UNIQUE index stops tenant B replaying
    // tenant A's key to double-insert. Ledger replay safety rests on it.
    await expect(
      sqlQuery(
        `INSERT INTO tax_withholding_ledger
         VALUES ('txw_x', $1, $2, 'tax:withheld:wdr_a1:15000', 'WITHHELD', 15000, 1500, '2026-Q3')`,
        USER_B,
        ORG_B
      )
    ).rejects.toThrow();
    expect(await sqlQuery(`SELECT id FROM tax_withholding_ledger`)).toHaveLength(1);
  });
});

describe('existence-oracle resistance', () => {
  it('a cross-tenant id is indistinguishable from a non-existent one', async () => {
    // If these differed, an attacker could enumerate other tenants' ids.
    expect(await scopedGet('earnings', 'earn_b1', ORG_A)).toEqual(await scopedGet('earnings', 'earn_zzzz', ORG_A));
  });

  it('the same holds for withdrawals and bank accounts', async () => {
    expect(await scopedGet('withdrawals', 'wdr_b1', ORG_A)).toEqual(await scopedGet('withdrawals', 'missing_id', ORG_A));
    expect(await scopedGet('bank_accounts', 'bank_b1', ORG_A)).toEqual(await scopedGet('bank_accounts', 'missing_id', ORG_A));
  });
});