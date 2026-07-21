-- ============================================================================
-- Subscription plans seed - Starter, Professional, Enterprise
-- All limits are configurable via the limits JSON field
-- ============================================================================

-- Starter Plan
INSERT INTO subscription_plans (id, name, tier, price_cents, limits) VALUES
('plan_starter', 'Starter', 'starter', 2900, '{
  "monthly_sms_allowance": 500,
  "ai_request_allowance": 1000,
  "storage_quota_mb": 1000,
  "memory_quota_mb": 500,
  "seats": 5,
  "api_rate_limit_per_minute": 60,
  "automation_limit": 10,
  "workflow_limit": 5
}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- Professional Plan
INSERT INTO subscription_plans (id, name, tier, price_cents, limits) VALUES
('plan_professional', 'Professional', 'professional', 9900, '{
  "monthly_sms_allowance": 5000,
  "ai_request_allowance": 10000,
  "storage_quota_mb": 10000,
  "memory_quota_mb": 2000,
  "seats": 25,
  "api_rate_limit_per_minute": 300,
  "automation_limit": 100,
  "workflow_limit": 50
}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- Enterprise Plan
INSERT INTO subscription_plans (id, name, tier, price_cents, limits) VALUES
('plan_enterprise', 'Enterprise', 'enterprise', 29900, '{
  "monthly_sms_allowance": 50000,
  "ai_request_allowance": 200000,
  "storage_quota_mb": 100000,
  "memory_quota_mb": 10000,
  "seats": 100,
  "api_rate_limit_per_minute": 1000,
  "automation_limit": 1000,
  "workflow_limit": 500
}'::jsonb)
ON CONFLICT (id) DO NOTHING;