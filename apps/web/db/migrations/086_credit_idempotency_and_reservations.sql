-- ============================================================================
-- Add idempotency support for credit transactions and credit reservations table
-- Required by apps/web/src/app/api/utils/credits.ts for:
--   - Preventing duplicate credit deductions/additions via idempotency_key
--   - Credit reservation system for pending operations
-- ============================================================================

-- Change credit_transactions.id from UUID to TEXT to support code-generated IDs
-- The code generates IDs like 'txn_1234567890_abc123def'
ALTER TABLE credit_transactions
  ALTER COLUMN id DROP DEFAULT,
  ALTER COLUMN id TYPE TEXT USING id::TEXT;

-- Add idempotency_key column to credit_transactions
ALTER TABLE credit_transactions
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- Create unique index for idempotency (allows NULL values)
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_transactions_idempotency
  ON credit_transactions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Add WITHDRAWAL to allowed transaction types (referenced in credits.ts TransactionType)
ALTER TABLE credit_transactions
  DROP CONSTRAINT IF EXISTS credit_transactions_type_check;

ALTER TABLE credit_transactions
  ADD CONSTRAINT credit_transactions_type_check
  CHECK (type IN ('PURCHASE', 'DEDUCT', 'REFUND', 'BONUS', 'ADJUSTMENT', 'WITHDRAWAL'));

-- Credit reservations table for pending operations
-- Used by reserveCredits/confirmReservation/releaseReservation functions
CREATE TABLE IF NOT EXISTS credit_reservations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'RELEASED', 'EXPIRED')),
  expires_at TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient reservation queries
CREATE INDEX IF NOT EXISTS idx_credit_reservations_org ON credit_reservations(organization_id);
CREATE INDEX IF NOT EXISTS idx_credit_reservations_status ON credit_reservations(status);
CREATE INDEX IF NOT EXISTS idx_credit_reservations_expires ON credit_reservations(expires_at)
  WHERE status = 'PENDING';

-- Index for summing pending reservations per organization
CREATE INDEX IF NOT EXISTS idx_credit_reservations_pending_sum
  ON credit_reservations(organization_id, amount)
  WHERE status = 'PENDING';
