-- Sellers' tax withholding + reporting.
--
-- CONTEXT
-- Owner requirement: an "earnings/tax-reporting document", "optional auto-tax
-- withholding", and "transparent withholding visibility". None of this existed.
-- The earnings surface was only /api/earnings and /api/earnings/[id]/refund,
-- and there was no withholding anywhere in the schema, so a seller's gross,
-- net and withheld amounts could not be distinguished, let alone reported.
--
-- DESIGN
-- - Money is integer CENTS everywhere. Rates are integer BASIS POINTS. No
--   floats in the money path, so totals are exactly reproducible and a re-run
--   cannot drift by a rounding error.
-- - The ledger is APPEND-ONLY and every row carries an idempotency_key with a
--   UNIQUE constraint, so a retried webhook, a double-clicked withdrawal, or a
--   replayed job cannot double-withhold. `kind` distinguishes WITHHELD (taken
--   from balance), RELEASED (returned to the seller) and ADJUSTMENT.
-- - Direction lives in `kind`, never in the sign of the amount, so a RELEASED
--   row can never be misread as a WITHHELD row of a smaller value.
--
-- SCOPE / HONESTY
-- This is NOT a tax filing system and computes no actual liability. No rate is
-- assumed universal: the rate is a per-user/organization setting and the
-- reporting surface carries an explicit "estimate, not a tax form" notice.
-- Jurisdiction and rate are configuration, never hardcoded.

-- - Per-user withholding preference ---------------------
CREATE TABLE IF NOT EXISTS public.tax_withholding_settings (
  user_id          text        NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  organization_id  text        NOT NULL,
  enabled          boolean     NOT NULL DEFAULT false,
  -- Basis points: 1500 = 15.00%. Bounded to 0..10000 (0%..100%).
  rate_bps         integer     NOT NULL DEFAULT 0,
  jurisdiction     text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, organization_id),
  CONSTRAINT tax_withholding_rate_bounds CHECK (rate_bps >= 0 AND rate_bps <= 10000)
);

-- - Append-only withholding ledger ----------------------
CREATE TABLE IF NOT EXISTS public.tax_withholding_ledger (
  id                text        PRIMARY KEY,
  user_id           text        NOT NULL,
  organization_id   text        NOT NULL,
  earning_id        text,
  withdrawal_id     text,
  -- UNIQUE: this is what makes the operation replay-safe.
  idempotency_key   text        NOT NULL UNIQUE,
  kind              text        NOT NULL
                      CHECK (kind IN ('WITHHELD', 'RELEASED', 'ADJUSTMENT')),
  amount_cents      bigint      NOT NULL CHECK (amount_cents > 0),
  rate_bps          integer     NOT NULL CHECK (rate_bps >= 0 AND rate_bps <= 10000),
  -- Tax period this belongs to, e.g. '2026-Q3'. Fixed at write time so a later
  -- period-boundary change cannot retroactively move a row between quarters.
  period_qualified  text        NOT NULL,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Reporting reads one seller's ledger across a period range.
CREATE INDEX IF NOT EXISTS idx_tax_withholding_ledger_user_period
  ON public.tax_withholding_ledger (user_id, organization_id, period_qualified);

-- Withdrawals join to their withholding rows.
CREATE INDEX IF NOT EXISTS idx_tax_withholding_ledger_withdrawal
  ON public.tax_withholding_ledger (withdrawal_id)
  WHERE withdrawal_id IS NOT NULL;