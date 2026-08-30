-- Migration 039 — record the Stripe refund id on the payments ledger.
-- The admin refund path (Phase 4, /api/payments/refund) now calls the Stripe
-- provider's refund() and mirrors the returned refund id here, so the local
-- record and the finance export can show which Stripe refund settled a payment.
-- ============================================================================

ALTER TABLE public.payments_ledger ADD COLUMN IF NOT EXISTS stripe_refund_id text;
