-- 004_assignment_fee.sql
-- Real per-deal revenue for analytics margin. Wholesale assignment fee (in
-- cents) captured on the contract when a deal closes, so profit margin is
-- computed from ACTUAL dollars instead of an assumed fee. Idempotent.

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS assignment_fee_cents integer;

COMMENT ON COLUMN contracts.assignment_fee_cents IS
  'Wholesale assignment fee for this deal, in cents. NULL = not yet recorded (analytics falls back to the ASSIGNMENT_FEE_CENTS estimate for that deal).';
