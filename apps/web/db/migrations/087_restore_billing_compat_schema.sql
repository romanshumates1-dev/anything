-- ============================================================================
-- Migration 087 — restore the compatibility schema the application reads
--
-- WHY THIS EXISTS
-- ----------------------------------------------------------------------------
-- The migrations on disk had never been fully applied to the deployed Neon
-- database, and could not be applied: 071/075/076/084/085 each aborted the
-- chain (all five are repaired in this same change). Everything from 080
-- onward — the whole credit system — was therefore missing, so every billing
-- and credits route failed at runtime with 42703 (undefined_column) or 42P01
-- (undefined_table).
--
-- This migration restores only what the CURRENT application code reads. It is
-- deliberately additive: nothing is re-typed, no row is deleted, and nothing
-- that already exists under a compatible definition is re-declared.
--
-- SOURCES OF TRUTH — do not create competing state machines
-- ----------------------------------------------------------------------------
--   organization_subscriptions             authoritative subscription state
--   subscription_plans                     authoritative plan catalogue
--   credit_balances / credit_transactions  authoritative credit state. Mutate
--                                          only via addCredits() /
--                                          deductCreditsForAction() in
--                                          src/app/api/utils/credits.ts, which
--                                          take an idempotencyKey.
--   billing_events                         authoritative billing audit history
--   a *verified* Stripe webhook            authoritative payment confirmation
--
-- The `organizations` columns below are COMPATIBILITY / LEGACY MIRRORS kept so
-- existing readers keep working. They are written only as a side effect of a
-- verified payment, and paid access must never be granted on their strength
-- alone.
-- ============================================================================

-- ── organizations: plan mirrors ─────────────────────────────────────────────
-- Read by GET/POST /api/billing/subscribe, /api/billing/refund and
-- src/app/api/utils/refundCalculator.ts.
ALTER TABLE public.organizations
  -- 'free' matches migration 068's default for public."user".subscription_tier
  -- and is the truthful value for an organization that has never bought a plan.
  ADD COLUMN IF NOT EXISTS subscription_tier TEXT NOT NULL DEFAULT 'free',
  -- WHOLE DOLLARS, not cents. refundCalculator.ts computes
  -- `(org.subscription_price || 0) * 100` and comments "stored in dollars".
  -- Every seeded plan price is a whole dollar amount ($99/$299/$699/$1799), so
  -- INTEGER is lossless here.
  ADD COLUMN IF NOT EXISTS subscription_price INTEGER,
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;

-- ── organizations: plan-limit mirrors ───────────────────────────────────────
-- Written by POST /api/billing/subscribe. A NULL means "fall back to the plan
-- catalogue", which is exactly what the GET handler already does with
-- `org.leads_limit || planConfig?.leads`.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS leads_limit INTEGER,
  ADD COLUMN IF NOT EXISTS sms_limit INTEGER,
  ADD COLUMN IF NOT EXISTS campaigns_limit INTEGER,
  ADD COLUMN IF NOT EXISTS users_limit INTEGER,
  ADD COLUMN IF NOT EXISTS features TEXT[] NOT NULL DEFAULT '{}';

-- ── organizations: legacy credit mirror ─────────────────────────────────────
-- DISPLAY/COMPATIBILITY ONLY — credit_balances is authoritative. Nothing gates
-- on this column; it exists so the billing page and the refund path keep
-- working.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS ai_credits INTEGER NOT NULL DEFAULT 0;

-- ── organizations: Stripe customer link ─────────────────────────────────────
-- Persisted so one organization maps to exactly ONE Stripe customer, instead of
-- a fresh customer being created on every checkout attempt.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

-- Unique both ways: one customer per organization, one organization per
-- customer. Partial so the (many) NULL rows stay unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_organizations_stripe_customer
  ON public.organizations (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- ── subscription_plans: Stripe price link ──────────────────────────────────
-- `checkout.session.completed` identifies the plan by the Stripe Price that was
-- sold, so this must be unique to be usable as a reverse lookup. Populate it per
-- environment with the real Stripe Price IDs (see DEPLOY.md).
ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS stripe_price_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_subscription_plans_stripe_price
  ON public.subscription_plans (stripe_price_id)
  WHERE stripe_price_id IS NOT NULL;

-- ── billing_events: authoritative billing audit history ────────────────────
-- Written by /api/billing/subscribe and read+written by /api/billing/refund,
-- but never created by any migration. Without it the subscribe path's audit
-- write was silently swallowed by a `.catch(console.error)` and the refund path
-- threw.
CREATE TABLE IF NOT EXISTS public.billing_events (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL,
  -- Dollars and signed: the refund path writes `-eligibleRefundCents / 100`,
  -- which is fractional, so NUMERIC rather than INTEGER.
  amount          NUMERIC(12, 2),
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- /api/billing/refund selects the newest payment event for an org filtered by
-- event_type; this index serves that exact access path.
CREATE INDEX IF NOT EXISTS idx_billing_events_org_type_created
  ON public.billing_events (organization_id, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_events_org_created
  ON public.billing_events (organization_id, created_at DESC);
