-- ============================================================================
-- Migration 067 — Value-based pricing with 97%+ margins
--
-- Pricing model: High-margin tiers optimized for perceived value
--
-- TIERS:
--   Free:     $0/mo    - 25 emails, 5 AI credits (hard cap, no overage)
--   Starter:  $129/mo  - 100 SMS, 500 emails, 250 AI credits
--   Pro:      $399/mo  - 300 SMS, 2,500 emails, 1,500 AI credits
--   Business: $899/mo  - 1,000 SMS, 10,000 emails, 5,000 AI credits
--   Scale:    $2,499/mo - 3,000 SMS, 50,000 emails, 20,000 AI credits
--
-- OVERAGE PRICING (per unit in cents):
--   SMS: $0.18 (Starter), $0.15 (Pro), $0.12 (Business), $0.09 (Scale)
--   Email: $0.01 (all paid tiers)
--   AI Credits: $0.15 (Starter), $0.12 (Pro), $0.08 (Business), $0.05 (Scale)
--
-- Free tier has hard caps (NULL overage pricing).
-- ============================================================================

BEGIN;

-- Update tier constraint to include all tiers
ALTER TABLE public.subscription_plans DROP CONSTRAINT IF EXISTS subscription_plans_tier_check;
ALTER TABLE public.subscription_plans ADD CONSTRAINT subscription_plans_tier_check
  CHECK (tier IN ('free', 'starter', 'pro', 'professional', 'business', 'scale', 'enterprise'));

-- Free: $0/mo - Hard caps, no overage allowed
INSERT INTO public.subscription_plans (id, name, tier, price_cents, limits) VALUES
('plan_free', 'Free', 'free', 0, '{
  "monthly_sms_allowance": 0,
  "monthly_email_allowance": 25,
  "monthly_ai_credits": 5,
  "overage_sms_cents": null,
  "overage_email_cents": null,
  "overage_ai_credit_cents": null,
  "campaigns": 1,
  "seats": 1,
  "api_rate_limit_per_minute": 10,
  "features": ["basic_crm", "lead_import", "test_mode_only"]
}'::jsonb)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      tier = EXCLUDED.tier,
      price_cents = EXCLUDED.price_cents,
      limits = EXCLUDED.limits,
      updated_at = now();

-- Starter: $129/mo - Entry tier for new wholesalers
INSERT INTO public.subscription_plans (id, name, tier, price_cents, limits) VALUES
('plan_starter', 'Starter', 'starter', 12900, '{
  "monthly_sms_allowance": 100,
  "monthly_email_allowance": 500,
  "monthly_ai_credits": 250,
  "overage_sms_cents": 18,
  "overage_email_cents": 1,
  "overage_ai_credit_cents": 15,
  "campaigns": 5,
  "seats": 2,
  "api_rate_limit_per_minute": 30,
  "automation_limit": 10,
  "workflow_limit": 5,
  "features": ["basic_crm", "lead_import", "ai_classification", "sms_outreach", "email_campaigns"]
}'::jsonb)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      tier = EXCLUDED.tier,
      price_cents = EXCLUDED.price_cents,
      limits = EXCLUDED.limits,
      updated_at = now();

-- Pro: $399/mo - Active wholesalers
INSERT INTO public.subscription_plans (id, name, tier, price_cents, limits) VALUES
('plan_pro', 'Pro', 'pro', 39900, '{
  "monthly_sms_allowance": 300,
  "monthly_email_allowance": 2500,
  "monthly_ai_credits": 1500,
  "overage_sms_cents": 15,
  "overage_email_cents": 1,
  "overage_ai_credit_cents": 12,
  "campaigns": 15,
  "seats": 5,
  "api_rate_limit_per_minute": 100,
  "automation_limit": 50,
  "workflow_limit": 25,
  "features": ["all_starter", "ai_negotiation", "contract_generation", "buyer_matching", "pipeline_automation", "analytics_dashboard", "priority_support"]
}'::jsonb)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      tier = EXCLUDED.tier,
      price_cents = EXCLUDED.price_cents,
      limits = EXCLUDED.limits,
      updated_at = now();

-- Business: $899/mo - Scaling wholesalers
INSERT INTO public.subscription_plans (id, name, tier, price_cents, limits) VALUES
('plan_business', 'Business', 'business', 89900, '{
  "monthly_sms_allowance": 1000,
  "monthly_email_allowance": 10000,
  "monthly_ai_credits": 5000,
  "overage_sms_cents": 12,
  "overage_email_cents": 1,
  "overage_ai_credit_cents": 8,
  "campaigns": 50,
  "seats": 15,
  "api_rate_limit_per_minute": 300,
  "automation_limit": 200,
  "workflow_limit": 100,
  "features": ["all_pro", "team_collaboration", "custom_branding", "api_access", "advanced_analytics", "phone_support"]
}'::jsonb)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      tier = EXCLUDED.tier,
      price_cents = EXCLUDED.price_cents,
      limits = EXCLUDED.limits,
      updated_at = now();

-- Scale: $2,499/mo - High-volume operations
INSERT INTO public.subscription_plans (id, name, tier, price_cents, limits) VALUES
('plan_scale', 'Scale', 'scale', 249900, '{
  "monthly_sms_allowance": 3000,
  "monthly_email_allowance": 50000,
  "monthly_ai_credits": 20000,
  "overage_sms_cents": 9,
  "overage_email_cents": 1,
  "overage_ai_credit_cents": 5,
  "campaigns": -1,
  "seats": 50,
  "api_rate_limit_per_minute": 600,
  "automation_limit": -1,
  "workflow_limit": -1,
  "features": ["all_business", "unlimited_campaigns", "dedicated_support", "custom_integrations", "priority_delivery", "advanced_reporting"]
}'::jsonb)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      tier = EXCLUDED.tier,
      price_cents = EXCLUDED.price_cents,
      limits = EXCLUDED.limits,
      updated_at = now();

-- Enterprise: Custom pricing (keep existing for enterprise sales)
INSERT INTO public.subscription_plans (id, name, tier, price_cents, limits) VALUES
('plan_enterprise', 'Enterprise', 'enterprise', 0, '{
  "monthly_sms_allowance": -1,
  "monthly_email_allowance": -1,
  "monthly_ai_credits": -1,
  "overage_sms_cents": null,
  "overage_email_cents": null,
  "overage_ai_credit_cents": null,
  "campaigns": -1,
  "seats": -1,
  "api_rate_limit_per_minute": 1000,
  "automation_limit": -1,
  "workflow_limit": -1,
  "features": ["all_scale", "unlimited_everything", "dedicated_support", "custom_integrations", "sla_guarantee", "onboarding_training", "white_label"]
}'::jsonb)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      tier = EXCLUDED.tier,
      price_cents = EXCLUDED.price_cents,
      limits = EXCLUDED.limits,
      updated_at = now();

COMMIT;
