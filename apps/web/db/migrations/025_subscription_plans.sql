-- ============================================================================
-- Subscription plans - configurable limits per plan tier
-- Limits are stored as JSON for flexibility
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id text PRIMARY KEY DEFAULT 'plan_' || gen_random_uuid()::text,
  name text NOT NULL,
  tier text NOT NULL CHECK (tier IN ('starter', 'professional', 'enterprise')),
  price_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'usd',
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_subscription_plans_tier ON public.subscription_plans (tier);

-- Default plans will be seeded separately
-- Starter, Professional, Enterprise with configurable limits