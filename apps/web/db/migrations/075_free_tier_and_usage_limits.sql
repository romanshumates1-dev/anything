-- ============================================================================
-- Migration 075 - Free tier subscription plan and enhanced usage tracking
--
-- Adds a genuinely useful free tier with:
-- - 10 leads (enough to evaluate the platform)
-- - 1 campaign (to test the workflow)
-- - 25 SMS messages (realistic for initial testing)
-- - 50 emails (generous for evaluation)
-- - Basic AI requests (10 per month)
--
-- Also adds usage tracking columns to organizations for fast limit checks.
-- ============================================================================

-- Add Free tier plan (price_cents = 0 for free)
INSERT INTO public.subscription_plans (id, name, tier, price_cents, limits) VALUES
('plan_free', 'Free', 'free', 0, '{
  "monthly_lead_allowance": 10,
  "monthly_sms_allowance": 25,
  "monthly_email_allowance": 50,
  "ai_request_allowance": 10,
  "campaigns": 1,
  "seats": 1,
  "api_rate_limit_per_minute": 10,
  "automation_limit": 1,
  "workflow_limit": 1,
  "is_free_tier": true
}'::jsonb)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name, tier = EXCLUDED.tier,
      price_cents = EXCLUDED.price_cents, limits = EXCLUDED.limits,
      updated_at = now();

-- Update tier constraint to include 'free'
ALTER TABLE public.subscription_plans
  DROP CONSTRAINT IF EXISTS subscription_plans_tier_check;
ALTER TABLE public.subscription_plans
  ADD CONSTRAINT subscription_plans_tier_check
  CHECK (tier IN ('free', 'starter', 'professional', 'enterprise'));

-- Add usage ledger metric types for leads, campaigns, email
ALTER TABLE public.usage_ledger
  DROP CONSTRAINT IF EXISTS usage_ledger_metric_type_check;
ALTER TABLE public.usage_ledger
  ADD CONSTRAINT usage_ledger_metric_type_check
  CHECK (metric_type IN ('sms', 'ai_request', 'storage', 'api_rate', 'automation', 'workflow', 'lead', 'campaign', 'email'));

-- Create free tier sample data table for seeding new accounts
CREATE TABLE IF NOT EXISTS public.free_tier_sample_leads (
  id serial PRIMARY KEY,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'seller',
  email text,
  phone text,
  address text,
  city text,
  state text,
  zip text,
  estimated_value integer,
  motivation_score integer DEFAULT 5,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Insert sample leads for free tier users (realistic but clearly demo data)
INSERT INTO public.free_tier_sample_leads (name, type, email, phone, address, city, state, zip, estimated_value, motivation_score, notes) VALUES
('Sarah Johnson (Sample)', 'seller', 'demo-sarah@example.test', '+15551234001', '123 Oak Lane', 'Austin', 'TX', '78701', 285000, 7, 'Inherited property, looking to sell quickly. Pre-foreclosure situation.'),
('Michael Chen (Sample)', 'seller', 'demo-michael@example.test', '+15551234002', '456 Maple Drive', 'Denver', 'CO', '80202', 325000, 8, 'Relocating for work. Motivated seller, wants to close within 45 days.'),
('Patricia Williams (Sample)', 'seller', 'demo-patricia@example.test', '+15551234003', '789 Cedar Street', 'Phoenix', 'AZ', '85001', 195000, 9, 'Vacant property, behind on taxes. High motivation to sell as-is.'),
('Robert Martinez (Sample)', 'seller', 'demo-robert@example.test', '+15551234004', '321 Birch Avenue', 'Atlanta', 'GA', '30301', 240000, 6, 'Tired landlord with rental property. Open to offers.'),
('Jennifer Davis (Sample)', 'seller', 'demo-jennifer@example.test', '+15551234005', '654 Pine Road', 'Nashville', 'TN', '37201', 275000, 7, 'Downsizing after kids moved out. Flexible on timeline.'),
('David Thompson (Sample)', 'buyer', 'demo-david@example.test', '+15551234006', NULL, 'Dallas', 'TX', '75201', 350000, NULL, 'Active cash buyer. Looking for 3BR+ properties under $350K.'),
('Amanda Garcia (Sample)', 'buyer', 'demo-amanda@example.test', '+15551234007', NULL, 'Houston', 'TX', '77001', 450000, NULL, 'Investor group, can close in 7 days. Prefers multi-family.'),
('James Wilson (Sample)', 'buyer', 'demo-buyer@example.test', '+15551234008', NULL, 'Orlando', 'FL', '32801', 275000, NULL, 'Fix-and-flip investor. Looking for properties with value-add potential.')
ON CONFLICT DO NOTHING;

-- Sample campaign template for free tier
CREATE TABLE IF NOT EXISTS public.free_tier_sample_campaigns (
  id serial PRIMARY KEY,
  name text NOT NULL,
  message_template text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.free_tier_sample_campaigns (name, message_template, description) VALUES
('Welcome Campaign (Sample)',
'Hi {{name}}, I noticed your property at {{address}} and wanted to reach out. We work with homeowners in {{city}} who are looking for a quick, hassle-free sale. Would you be open to a brief conversation about your options?

Reply STOP to opt out.',
'A friendly initial outreach template for seller leads. Compliant with TCPA requirements.')
ON CONFLICT DO NOTHING;

-- Index for faster usage lookups by organization and period
CREATE INDEX IF NOT EXISTS idx_usage_ledger_org_period_metric
  ON public.usage_ledger (organization_id, period_start, period_end, metric_type);
