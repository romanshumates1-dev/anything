-- ============================================================================
-- Organization subscriptions - links org to plan with status
-- Supports trial, active, past_due, canceled, expired states
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.organization_subscriptions (
  id text PRIMARY KEY DEFAULT 'sub_' || gen_random_uuid()::text,
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_id text NOT NULL REFERENCES public.subscription_plans(id),
  status text NOT NULL CHECK (status IN ('trial', 'active', 'past_due', 'canceled', 'expired')),
  started_at timestamptz NOT NULL DEFAULT now(),
  current_period_start timestamptz NOT NULL DEFAULT now(),
  current_period_end timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  trial_ends_at timestamptz,
  payment_processor_subscription_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_organization_subscriptions_org ON public.organization_subscriptions (organization_id);
CREATE INDEX IF NOT EXISTS idx_organization_subscriptions_status ON public.organization_subscriptions (status);