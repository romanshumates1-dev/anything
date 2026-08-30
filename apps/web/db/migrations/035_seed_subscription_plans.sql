-- ============================================================================
-- Migration 035 — seed subscription_plans (SINGLE SOURCE OF TRUTH for pricing)
--
-- Prompt 1 Phase 1: the marketing /pricing page and the billing code
-- (/api/subscriptions, /api/admin/subscriptions, usageTracker) must read the
-- SAME price. Before this, prices were hardcoded in the TSX page ($99/$249)
-- AND a never-run seed file ($29/$99/$299) — two divergent sources, and the
-- live table was EMPTY (billing JOINs returned nothing). This migration makes
-- subscription_plans the one source; the pricing page now reads it.
--
-- price_cents is NOT NULL, so Enterprise uses 0 as the "custom / contact sales"
-- sentinel (the page renders "Let's talk", billing never self-serve-charges it).
--
-- Values reconciled to the publicly-advertised marketing numbers (the
-- hand-authored, product-specific tier — Starter $99, Professional $249,
-- Enterprise custom). If these are wrong, THIS FILE is the only place to change
-- them. Owner decision item logged in SESSION_HANDOFF.md.
--
-- UPSERT (not DO NOTHING) so re-running converges any DB that carried the old
-- boilerplate values. Idempotent.
-- ============================================================================

INSERT INTO public.subscription_plans (id, name, tier, price_cents, limits) VALUES
('plan_starter', 'Starter', 'starter', 9900, '{
  "monthly_lead_allowance": 1000,
  "monthly_sms_allowance": 500,
  "ai_request_allowance": 1000,
  "campaigns": 1,
  "seats": 5,
  "api_rate_limit_per_minute": 60,
  "automation_limit": 10,
  "workflow_limit": 5
}'::jsonb)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name, tier = EXCLUDED.tier,
      price_cents = EXCLUDED.price_cents, limits = EXCLUDED.limits,
      updated_at = now();

INSERT INTO public.subscription_plans (id, name, tier, price_cents, limits) VALUES
('plan_professional', 'Professional', 'professional', 24900, '{
  "monthly_lead_allowance": 10000,
  "monthly_sms_allowance": 5000,
  "ai_request_allowance": 10000,
  "campaigns": -1,
  "seats": 25,
  "api_rate_limit_per_minute": 300,
  "automation_limit": 100,
  "workflow_limit": 50
}'::jsonb)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name, tier = EXCLUDED.tier,
      price_cents = EXCLUDED.price_cents, limits = EXCLUDED.limits,
      updated_at = now();

INSERT INTO public.subscription_plans (id, name, tier, price_cents, limits) VALUES
('plan_enterprise', 'Enterprise', 'enterprise', 0, '{
  "monthly_lead_allowance": -1,
  "monthly_sms_allowance": 50000,
  "ai_request_allowance": 200000,
  "campaigns": -1,
  "seats": -1,
  "api_rate_limit_per_minute": 1000,
  "automation_limit": 1000,
  "workflow_limit": 500
}'::jsonb)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name, tier = EXCLUDED.tier,
      price_cents = EXCLUDED.price_cents, limits = EXCLUDED.limits,
      updated_at = now();
