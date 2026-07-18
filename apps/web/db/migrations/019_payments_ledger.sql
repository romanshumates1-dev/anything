-- 019_payments_ledger.sql
-- Phase P2: Assignment-fee payment ledger. Append-only — corrections are new
-- rows, never UPDATE of amounts. Stripe PaymentIntents are the source of truth
-- for payment status; this table mirrors the relevant subset.
-- Idempotent. Rollback: DROP TABLE payments_ledger;

CREATE TABLE IF NOT EXISTS public.payments_ledger (
  id                      text PRIMARY KEY,
  contract_id             text NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  buyer_id                bigint,
  amount_cents            bigint NOT NULL CHECK (amount_cents > 0),
  currency                text NOT NULL DEFAULT 'usd',
  stripe_payment_intent_id text,
  stripe_event_ids        text[] NOT NULL DEFAULT '{}',
  status                  text NOT NULL DEFAULT 'created'
                          CHECK (status IN ('created','sent','paid','failed','refunded')),
  reason                  text,  -- e.g. 'owner_refund', 'wire_transfer', 'at_closing'
  created_at              timestamptz NOT NULL DEFAULT now(),
  paid_at                 timestamptz,
  refunded_at             timestamptz
);

-- Fast lookup by contract.
CREATE INDEX IF NOT EXISTS idx_payments_ledger_contract
  ON public.payments_ledger (contract_id);

-- Fast lookup by status (for pending/overdue queries).
CREATE INDEX IF NOT EXISTS idx_payments_ledger_status
  ON public.payments_ledger (status);

-- Unique index on Stripe PI to prevent duplicate processing.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_payments_stripe_pi
  ON public.payments_ledger (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

COMMENT ON TABLE public.payments_ledger IS
  'Phase P2: Assignment-fee payments. Append-only ledger; Stripe PaymentIntents are the source of truth.';