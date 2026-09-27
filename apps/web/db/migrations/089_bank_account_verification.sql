-- 089: bank account storage + micro-deposit verification
--
-- CONTEXT
-- The `bank_accounts` table has existed since 073, and /api/withdrawals POST
-- has always required a default + verified row before it will move money. But
-- 073 only defined `last_four` — enough to DISPLAY an account, not enough to
-- actually PAY one — and no route could write to the table at all. Sellers
-- could accrue earnings and had no path to a payout.
--
-- This migration is strictly ADDITIVE: no existing column is altered or
-- dropped, so it is safe to apply to a populated database.
--
-- SECURITY
-- - Routing and account numbers are stored ONLY as AES-256-GCM ciphertext
--   (encrypted by the app with ENCRYPTION_KEY, never in SQL). Plaintext is
--   never persisted, so a database-only compromise does not yield usable
--   account numbers.
-- - `account_fingerprint` is a keyed HMAC (ENCRYPTION_KEY) used for duplicate
--   detection. It is deterministic so we can look up a duplicate, but it is
--   not reversible without the key, and it is scoped per user.
-- - `verification_amounts_encrypted` holds the expected micro-deposit amounts.
--   The search space is two values under $1.00, so the verify route hard-caps
--   attempts (MAX_VERIFICATION_ATTEMPTS) to prevent brute force.

ALTER TABLE public.bank_accounts
  ADD COLUMN IF NOT EXISTS routing_number_encrypted text,
  ADD COLUMN IF NOT EXISTS account_number_encrypted text,
  ADD COLUMN IF NOT EXISTS account_fingerprint text,
  ADD COLUMN IF NOT EXISTS verification_id text,
  ADD COLUMN IF NOT EXISTS verification_amounts_encrypted text,
  ADD COLUMN IF NOT EXISTS verification_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_attempts integer NOT NULL DEFAULT 0;

-- Duplicate lookup (duplicate account rejection) — scoped to the owner.
CREATE INDEX IF NOT EXISTS idx_bank_accounts_fingerprint
  ON public.bank_accounts (user_id, account_fingerprint)
  WHERE account_fingerprint IS NOT NULL;

-- NOTE: the "at most one default per user" invariant is already enforced by
-- idx_bank_accounts_default (unique, partial on is_default = true), created in
-- 073_earnings_escrow.sql. We deliberately do not add a second index for it.

-- Withdrawals and earnings look the default account up on every payout.
CREATE INDEX IF NOT EXISTS idx_bank_accounts_user_default
  ON public.bank_accounts (user_id, organization_id)
  WHERE is_default = true;
