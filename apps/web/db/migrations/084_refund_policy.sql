-- ============================================================================
-- 7-day refund policy with credit usage tracking
-- Subscriptions refundable within 7 days MINUS credits used
-- Credits spent with third parties (Twilio, AWS, AI) are non-refundable
-- ============================================================================

-- Track subscription purchase date for refund eligibility
ALTER TABLE organization_subscriptions
  ADD COLUMN IF NOT EXISTS purchased_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS refund_eligible_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refund_amount_cents INTEGER;

-- Update existing subscriptions to set refund_eligible_until = purchased_at + 7 days
UPDATE organization_subscriptions
SET
  purchased_at = COALESCE(purchased_at, started_at, created_at),
  refund_eligible_until = COALESCE(purchased_at, started_at, created_at) + INTERVAL '7 days'
WHERE refund_eligible_until IS NULL;

-- Create index for efficient refund eligibility queries
CREATE INDEX IF NOT EXISTS idx_org_subscriptions_refund_eligible
  ON organization_subscriptions (refund_eligible_until)
  WHERE refunded_at IS NULL;

-- Also track on the organizations table for simpler queries (denormalized)
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS subscription_purchased_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_refund_eligible_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_refunded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_refund_amount_cents INTEGER;

-- Backfill organizations table with refund eligibility
UPDATE organizations
SET
  subscription_purchased_at = COALESCE(subscription_purchased_at, created_at),
  subscription_refund_eligible_until = COALESCE(subscription_purchased_at, created_at) + INTERVAL '7 days'
WHERE subscription_tier IS NOT NULL
  AND subscription_refund_eligible_until IS NULL;

-- Track subscription refund requests for audit trail
CREATE TABLE IF NOT EXISTS subscription_refund_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,

  -- Original subscription details
  subscription_tier TEXT NOT NULL,
  subscription_price_cents INTEGER NOT NULL,
  purchased_at TIMESTAMPTZ NOT NULL,

  -- Refund calculation details
  credits_used_since_purchase INTEGER NOT NULL DEFAULT 0,
  credits_cost_cents INTEGER NOT NULL DEFAULT 0,
  eligible_refund_cents INTEGER NOT NULL,

  -- Processing status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'processed', 'rejected', 'failed')),
  stripe_refund_id TEXT,
  rejection_reason TEXT,

  -- Timestamps
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refund_requests_org ON subscription_refund_requests(organization_id);
CREATE INDEX IF NOT EXISTS idx_refund_requests_status ON subscription_refund_requests(status);
CREATE INDEX IF NOT EXISTS idx_refund_requests_requested ON subscription_refund_requests(requested_at DESC);

-- Function to calculate non-refundable credit cost
-- Based on average cost per credit for the organization's tier
COMMENT ON TABLE subscription_refund_requests IS
  'Tracks subscription refund requests with credit deduction calculations.
   Credits used are deducted from refund amount since third-party costs (Twilio, AWS, AI) cannot be recovered.';
