-- 014_billing.sql
-- Monetization foundation: subscription tiers, usage metering, Twilio spend
-- ledger, Stripe webhook idempotency, and 10DLC registration-grace.
--
-- Integrates with the EXISTING better-auth user table (public."user", text id).
-- There is NO second users table. Plan/limit numbers live in code
-- (src/config/plans.ts) — this schema stores only per-user STATE, never the
-- catalog. Idempotent: safe to re-run.

-- ── subscriptions ───────────────────────────────────────────────────────────
-- Exactly one row per user (created on signup as a trialing 'starter'; updated
-- by the Stripe webhook). `plan` is a PlanId from src/config/plans.ts.
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'starter',
  status text NOT NULL DEFAULT 'trialing',
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_price_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  -- Registration grace: while true, SMS traffic tagged category='registration'
  -- (10DLC campaign/number registration) does NOT consume the plan allowance,
  -- and the days spent in grace are added back to the paid window. Owner rule:
  -- burning someone's paid month while a carrier reviews their 10DLC campaign
  -- is a cruel experience, so it is explicitly excluded.
  registration_grace boolean NOT NULL DEFAULT false,
  registration_grace_started_at timestamptz,
  registration_grace_days_banked int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_subscriptions_user ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer ON public.subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_sub ON public.subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON public.subscriptions(status);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_status_check') THEN
    ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_status_check
      CHECK (status IN ('trialing','active','past_due','canceled','incomplete','incomplete_expired','unpaid','paused'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_plan_check') THEN
    ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_plan_check
      CHECK (plan IN ('starter','professional','enterprise'));
  END IF;
END $$;

COMMENT ON TABLE public.subscriptions IS
  'Per-user subscription state (Stripe-backed or trial). One row per user. Plan/limit catalog lives in src/config/plans.ts, not here.';

-- ── usage_counters ──────────────────────────────────────────────────────────
-- Per-user, per-period, per-metric counters. `category` separates normal
-- 'campaign' usage (counts against the cap) from 'registration' usage (grace,
-- does NOT count). `period` is the billing-period tag (YYYY-MM or a Stripe
-- period id) so a new period starts a fresh count.
CREATE TABLE IF NOT EXISTS public.usage_counters (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  period text NOT NULL,
  metric text NOT NULL,
  category text NOT NULL DEFAULT 'campaign',
  count bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_usage_counter
  ON public.usage_counters(user_id, period, metric, category);
CREATE INDEX IF NOT EXISTS idx_usage_counter_user_period
  ON public.usage_counters(user_id, period);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usage_counters_category_check') THEN
    ALTER TABLE public.usage_counters ADD CONSTRAINT usage_counters_category_check
      CHECK (category IN ('campaign','registration'));
  END IF;
END $$;

COMMENT ON TABLE public.usage_counters IS
  'Per-user/period/metric usage. category=registration is 10DLC-grace traffic that does not count against the plan cap.';

-- ── twilio_spend_ledger ─────────────────────────────────────────────────────
-- Append-only true-cost ledger. The cap is enforced on both segment count AND
-- realized spend, so a plan can never cost more in Twilio than its fee funds.
CREATE TABLE IF NOT EXISTS public.twilio_spend_ledger (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  period text NOT NULL,
  segments int NOT NULL DEFAULT 1,
  cost_cents numeric(12,4) NOT NULL DEFAULT 0,
  category text NOT NULL DEFAULT 'campaign',
  message_sid text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_twilio_spend_user_period
  ON public.twilio_spend_ledger(user_id, period);
CREATE INDEX IF NOT EXISTS idx_twilio_spend_sid
  ON public.twilio_spend_ledger(message_sid);

COMMENT ON TABLE public.twilio_spend_ledger IS
  'Append-only realized Twilio cost per send. Cap enforced on cumulative cost, not just count.';

-- ── billing_events (Stripe webhook idempotency) ─────────────────────────────
-- A Stripe event id processed exactly once; replays are no-ops (Phase-5 rule).
CREATE TABLE IF NOT EXISTS public.billing_events (
  event_id text PRIMARY KEY,
  type text NOT NULL,
  user_id text,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb
);

CREATE INDEX IF NOT EXISTS idx_billing_events_type ON public.billing_events(type);

COMMENT ON TABLE public.billing_events IS
  'Stripe webhook idempotency ledger — one row per event id; replayed events short-circuit.';
