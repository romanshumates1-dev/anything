-- ============================================================================
-- Migration 066 — ChatGPT-style AI credit + subscription pricing
--
-- Pricing model: Subscription tiers + usage-based AI credits
-- Modeled after ChatGPT/Claude pricing for familiarity
--
-- TIERS:
--   Free:        $0/mo   - 50 AI credits, 100 leads, 50 SMS, test mode only
--   Starter:     $29/mo  - 500 AI credits, 1,000 leads, 500 SMS
--   Pro:         $79/mo  - 2,500 AI credits, 10,000 leads, 5,000 SMS
--   Business:    $199/mo - 10,000 AI credits, unlimited leads, 25,000 SMS
--   Enterprise:  Custom  - Unlimited everything, dedicated support
--
-- CREDIT COSTS (approximate):
--   AI classification: 1 credit
--   AI negotiation response: 5 credits
--   AI contract analysis: 10 credits
--
-- This replaces the previous $99/$249 pricing which was too high for entry.
-- ============================================================================

-- First, drop the old constraint and add the new one with more tiers
ALTER TABLE public.subscription_plans DROP CONSTRAINT IF EXISTS subscription_plans_tier_check;
ALTER TABLE public.subscription_plans ADD CONSTRAINT subscription_plans_tier_check
  CHECK (tier IN ('free', 'starter', 'pro', 'professional', 'business', 'enterprise'));

-- Update existing plans with new ChatGPT-style pricing
UPDATE public.subscription_plans SET
  name = 'Free',
  tier = 'free',
  price_cents = 0,
  limits = '{
    "monthly_ai_credits": 50,
    "monthly_lead_allowance": 100,
    "monthly_sms_allowance": 50,
    "monthly_email_allowance": 200,
    "campaigns": 1,
    "seats": 1,
    "api_rate_limit_per_minute": 10,
    "automation_limit": 1,
    "workflow_limit": 1,
    "features": ["basic_crm", "lead_import", "test_mode_only"]
  }'::jsonb,
  updated_at = now()
WHERE id = 'plan_starter';

-- Insert Free tier if it doesn't exist
INSERT INTO public.subscription_plans (id, name, tier, price_cents, limits) VALUES
('plan_free', 'Free', 'free', 0, '{
  "monthly_ai_credits": 50,
  "monthly_lead_allowance": 100,
  "monthly_sms_allowance": 50,
  "monthly_email_allowance": 200,
  "campaigns": 1,
  "seats": 1,
  "api_rate_limit_per_minute": 10,
  "automation_limit": 1,
  "workflow_limit": 1,
  "features": ["basic_crm", "lead_import", "test_mode_only"]
}'::jsonb)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name, tier = EXCLUDED.tier,
      price_cents = EXCLUDED.price_cents, limits = EXCLUDED.limits,
      updated_at = now();

-- Starter: $29/mo - Entry tier for new wholesalers
INSERT INTO public.subscription_plans (id, name, tier, price_cents, limits) VALUES
('plan_starter', 'Starter', 'starter', 2900, '{
  "monthly_ai_credits": 500,
  "monthly_lead_allowance": 1000,
  "monthly_sms_allowance": 500,
  "monthly_email_allowance": 2000,
  "campaigns": 3,
  "seats": 2,
  "api_rate_limit_per_minute": 30,
  "automation_limit": 5,
  "workflow_limit": 3,
  "overage_ai_credit_cents": 5,
  "overage_sms_cents": 3,
  "features": ["basic_crm", "lead_import", "ai_classification", "sms_outreach", "email_campaigns"]
}'::jsonb)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name, tier = EXCLUDED.tier,
      price_cents = EXCLUDED.price_cents, limits = EXCLUDED.limits,
      updated_at = now();

-- Pro: $79/mo - Active wholesalers doing 1-5 deals/month
INSERT INTO public.subscription_plans (id, name, tier, price_cents, limits) VALUES
('plan_pro', 'Pro', 'pro', 7900, '{
  "monthly_ai_credits": 2500,
  "monthly_lead_allowance": 10000,
  "monthly_sms_allowance": 5000,
  "monthly_email_allowance": 25000,
  "campaigns": 10,
  "seats": 5,
  "api_rate_limit_per_minute": 100,
  "automation_limit": 25,
  "workflow_limit": 15,
  "overage_ai_credit_cents": 4,
  "overage_sms_cents": 2,
  "features": ["all_starter", "ai_negotiation", "contract_generation", "buyer_matching", "pipeline_automation", "analytics_dashboard", "priority_support"]
}'::jsonb)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name, tier = EXCLUDED.tier,
      price_cents = EXCLUDED.price_cents, limits = EXCLUDED.limits,
      updated_at = now();

-- Business: $199/mo - Scaling wholesalers doing 5-20 deals/month
INSERT INTO public.subscription_plans (id, name, tier, price_cents, limits) VALUES
('plan_business', 'Business', 'business', 19900, '{
  "monthly_ai_credits": 10000,
  "monthly_lead_allowance": -1,
  "monthly_sms_allowance": 25000,
  "monthly_email_allowance": 100000,
  "campaigns": -1,
  "seats": 15,
  "api_rate_limit_per_minute": 300,
  "automation_limit": 100,
  "workflow_limit": 50,
  "overage_ai_credit_cents": 3,
  "overage_sms_cents": 1,
  "features": ["all_pro", "unlimited_leads", "team_collaboration", "custom_branding", "api_access", "advanced_analytics", "phone_support"]
}'::jsonb)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name, tier = EXCLUDED.tier,
      price_cents = EXCLUDED.price_cents, limits = EXCLUDED.limits,
      updated_at = now();

-- Enterprise: Custom pricing
INSERT INTO public.subscription_plans (id, name, tier, price_cents, limits) VALUES
('plan_enterprise', 'Enterprise', 'enterprise', 0, '{
  "monthly_ai_credits": -1,
  "monthly_lead_allowance": -1,
  "monthly_sms_allowance": -1,
  "monthly_email_allowance": -1,
  "campaigns": -1,
  "seats": -1,
  "api_rate_limit_per_minute": 1000,
  "automation_limit": -1,
  "workflow_limit": -1,
  "features": ["all_business", "unlimited_everything", "dedicated_support", "custom_integrations", "sla_guarantee", "onboarding_training"]
}'::jsonb)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name, tier = EXCLUDED.tier,
      price_cents = EXCLUDED.price_cents, limits = EXCLUDED.limits,
      updated_at = now();

-- Don't delete professional plan - just update it to be an alias for pro
UPDATE public.subscription_plans SET
  name = 'Pro (Legacy)',
  tier = 'pro',
  price_cents = 7900,
  limits = (SELECT limits FROM public.subscription_plans WHERE id = 'plan_pro'),
  updated_at = now()
WHERE id = 'plan_professional' AND EXISTS (SELECT 1 FROM public.subscription_plans WHERE id = 'plan_professional');

-- Add AI credit tracking table
CREATE TABLE IF NOT EXISTS ai_credit_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID,
  user_id TEXT NOT NULL,
  operation_type TEXT NOT NULL, -- 'classification', 'negotiation', 'contract_analysis', etc.
  credits_used INT NOT NULL DEFAULT 1,
  lead_id TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_credit_usage_org_month ON ai_credit_usage (organization_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_credit_usage_user ON ai_credit_usage (user_id, created_at);

-- Add credit purchase table for one-time credit packs
CREATE TABLE IF NOT EXISTS credit_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID,
  user_id TEXT NOT NULL,
  credits_purchased INT NOT NULL,
  amount_cents INT NOT NULL,
  stripe_payment_intent_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, completed, failed, refunded
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_credit_purchases_org ON credit_purchases (organization_id, created_at);

-- Credit pack pricing (one-time purchases)
-- 100 credits = $5 ($0.05/credit)
-- 500 credits = $20 ($0.04/credit) - 20% savings
-- 1000 credits = $35 ($0.035/credit) - 30% savings
-- 5000 credits = $150 ($0.03/credit) - 40% savings
CREATE TABLE IF NOT EXISTS credit_packs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  credits INT NOT NULL,
  price_cents INT NOT NULL,
  savings_percent INT DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO credit_packs (id, name, credits, price_cents, savings_percent) VALUES
('pack_100', '100 AI Credits', 100, 500, 0),
('pack_500', '500 AI Credits', 500, 2000, 20),
('pack_1000', '1,000 AI Credits', 1000, 3500, 30),
('pack_5000', '5,000 AI Credits', 5000, 15000, 40)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name, credits = EXCLUDED.credits,
      price_cents = EXCLUDED.price_cents, savings_percent = EXCLUDED.savings_percent;
