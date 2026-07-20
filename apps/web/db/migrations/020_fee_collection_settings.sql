-- 020_fee_collection_settings.sql
-- Phase P2: Per-contract fee collection settings.
-- Idempotent. Rollback: ALTER TABLE contracts DROP COLUMN IF EXISTS fee_collection;
--                      ALTER TABLE contracts DROP COLUMN IF EXISTS fee_config;

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS fee_collection text NOT NULL DEFAULT 'at_closing'
  CHECK (fee_collection IN ('collect_now', 'at_closing'));

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS fee_config jsonb DEFAULT '{}';

COMMENT ON COLUMN public.contracts.fee_collection IS
  'collect_now = create payment link immediately on signed; at_closing = collect at title close (default).';

COMMENT ON COLUMN public.contracts.fee_config IS
  'JSON: {type: "percent"|"flat", value: number} for configurable fee calculation.';