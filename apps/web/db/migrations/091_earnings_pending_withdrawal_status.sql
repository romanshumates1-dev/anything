-- 091_earnings_pending_withdrawal_status.sql
--
-- WHY THIS EXISTS
-- ---------------
-- 073_earnings_escrow.sql created `earnings.status` as:
--
--   CHECK (status IN ('PENDING', 'AVAILABLE', 'WITHDRAWN', 'REFUNDED'))
--
-- but POST /api/withdrawals reserves an earning by writing
--
--   status = 'PENDING_WITHDRAWAL'
--
-- That value appears in NO migration. The state therefore does not exist as
-- far as the database is concerned, so the reservation UPDATE in the
-- withdrawal path would fail its CHECK and surface as a 500 on EVERY
-- withdrawal request - the seller's money could never leave the platform.
--
-- This was invisible to the test suite because 116 test files mock the `sql`
-- utility wholesale, so no test ever evaluated a real CHECK constraint. It is
-- the same blind spot that hid 073-090 never being applied to the configured
-- database at all.
--
-- WHY WIDEN THE CONSTRAINT INSTEAD OF RENAMING THE STATE
-- -----------------------------------------------------
-- 'PENDING_WITHDRAWAL' is the correct model. `AVAILABLE` means "the inspection
-- period has passed and this is withdrawable"; the reservation is a distinct
-- claim that a specific in-flight withdrawal owns these rows, which is what
-- makes double-spend impossible. Collapsing the two would lose the ability to
-- tell a reserved earning from a free one. The column `withdrawal_id` already
-- links the two tables, so this is the state the design always intended.
--
-- IDEMPOTENT: DROP ... IF EXISTS followed by ADD means re-running simply
-- replaces the constraint with an identical one. Safe for scripts/migrate.mjs.
--
-- ROLLBACK: re-add the constraint without 'PENDING_WITHDRAWAL' *after* first
-- releasing any reserved rows:
--   UPDATE earnings SET status='AVAILABLE', withdrawal_id=NULL
--    WHERE status='PENDING_WITHDRAWAL';

ALTER TABLE public.earnings DROP CONSTRAINT IF EXISTS earnings_status_check;

ALTER TABLE public.earnings ADD CONSTRAINT earnings_status_check
  CHECK (status IN ('PENDING', 'AVAILABLE', 'PENDING_WITHDRAWAL', 'WITHDRAWN', 'REFUNDED'));

-- The cron that promotes matured earnings filters on status = 'PENDING' only,
-- so a reserved row can never be re-promoted and re-spent. Add an index for the
-- reserved state because the withdrawal path's balance check reads it.
CREATE INDEX IF NOT EXISTS idx_earnings_pending_withdrawal
  ON public.earnings (user_id, organization_id)
  WHERE status = 'PENDING_WITHDRAWAL';
