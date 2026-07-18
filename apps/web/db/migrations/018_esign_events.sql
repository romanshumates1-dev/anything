-- 018_esign_events.sql
-- Phase P1: E-Sign event tracking. Every signing event (sent, viewed, signed,
-- countersigned) is recorded here. The webhook handler idempotently inserts
-- rows keyed on (contract_id, event_type, external_event_id). The contract
-- status machine extends to: PENDING_SIGNATURE → SENT → VIEWED → SIGNED → COUNTERSIGNED.
-- Idempotent. Rollback: DROP TABLE esign_events; ALTER TABLE contracts DROP COLUMN IF EXISTS esign_status;

CREATE TABLE IF NOT EXISTS public.esign_events (
  id                text PRIMARY KEY,
  contract_id       text NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  event_type        text NOT NULL CHECK (event_type IN ('sent','viewed','signed','countersigned')),
  external_event_id text,
  event_data        jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Fast lookup by contract + event type for idempotency checks.
CREATE INDEX IF NOT EXISTS idx_esign_events_contract
  ON public.esign_events (contract_id, event_type);

-- Unique constraint for idempotent webhook processing: same external event
-- should never create duplicate rows.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_esign_external_event
  ON public.esign_events (contract_id, external_event_id)
  WHERE external_event_id IS NOT NULL;

-- Add esign_status column to contracts table for the extended status machine.
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS esign_status text
  CHECK (esign_status IN ('pending','sent','viewed','signed','countersigned'));

-- Default all existing contracts to 'pending'.
UPDATE public.contracts SET esign_status = 'pending' WHERE esign_status IS NULL;

-- Make esign_status NOT NULL after backfill.
ALTER TABLE public.contracts
  ALTER COLUMN esign_status SET NOT NULL;

COMMENT ON TABLE public.esign_events IS
  'Phase P1: e-sign lifecycle events. Webhook handler inserts idempotently; contract status machine reads latest event_type per contract.';