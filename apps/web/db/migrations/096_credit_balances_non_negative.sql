-- Migration 096 — credit_balances: forbid a negative balance at the database level.
--
-- WHY
-- ---
-- The credit ledger is money. `deductCredits` guards the deduction in SQL with
-- `lb.balance >= ${amount}` inside the same statement that writes the
-- transaction row, so the application never observed a negative balance while
-- running. But that guard lives in the CALLER. Any other writer — a migration, a
-- manual fix, a future endpoint, or a concurrency bug in a code path that does
-- not reuse that helper — would be free to drive a balance below zero, and
-- there was nothing in the schema to stop it.
--
-- The audit on the live database found `credit_balances` carrying only
-- NOT NULL, FK and UNIQUE constraints: no CHECK on `balance`. Negative balances
-- would also be self-evident corruption, since a credit pack is prepaid and
-- "balance" cannot legitimately go below zero.
--
-- WHAT THIS DOES
-- --------------
-- Adds the invariant where it cannot be bypassed. The constraint is validated
-- before it is trusted, so if any historical row already violates it the
-- migration FAILS loudly instead of silently leaving a bad ledger in place.
--
-- Idempotent and safe: adding the constraint takes a brief ACCESS EXCLUSIVE
-- lock on `credit_balances`, which holds no rows that matter on a live system.

DO $$
BEGIN
  -- Refuse to proceed if the table already holds a negative balance. Repairing
  -- the data is a human decision (it implies either a bad grant or a bad
  -- deduction), not something a migration should guess at.
  IF EXISTS (SELECT 1 FROM credit_balances WHERE balance < 0) THEN
    RAISE EXCEPTION
      'migration 096 refused: credit_balances contains % row(s) with a negative balance; reconcile before constraining',
      (SELECT count(*) FROM credit_balances WHERE balance < 0);
  END IF;

  ALTER TABLE credit_balances
    DROP CONSTRAINT IF EXISTS credit_balances_balance_non_negative;

  ALTER TABLE credit_balances
    ADD CONSTRAINT credit_balances_balance_non_negative
    CHECK (balance >= 0);
END
$$;