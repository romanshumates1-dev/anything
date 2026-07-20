-- 016_inspection_clock.sql
-- Phase V-R: the 7-14-day inspection clock on contracts.
--   inspection_days        7-14 (default 10) — the assignment window
--   contract_price_cents   needed for the day-N-2 "lowest viable ask" math
--                          (lowest_ask = contract_price + fee_floor)
--   assigned_at            null until assigned; urgency hooks skip when set
-- Idempotent. Rollback: ALTER TABLE public.contracts DROP COLUMN IF EXISTS
-- inspection_days, DROP COLUMN IF EXISTS contract_price_cents, DROP COLUMN IF
-- EXISTS assigned_at;

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS inspection_days integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS contract_price_cents bigint,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz;

-- 7-14 bound (idempotent constraint add).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contracts_inspection_days_chk' AND conrelid = 'public.contracts'::regclass
  ) THEN
    ALTER TABLE public.contracts
      ADD CONSTRAINT contracts_inspection_days_chk CHECK (inspection_days BETWEEN 7 AND 14);
  END IF;
END $$;

COMMENT ON COLUMN public.contracts.inspection_days IS
  'Assignment window (7-14 days, default 10). Clock starts at created_at; urgency jobs fire day 3 and day N-2 unless assigned_at is set.';
