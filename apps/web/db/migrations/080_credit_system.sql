-- ============================================================================
-- Credit-based billing system with tier-specific surcharges
-- Users must purchase platform credits to use outreach features
-- ============================================================================

-- Credit balances per organization
CREATE TABLE IF NOT EXISTS credit_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id TEXT NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 0,
  lifetime_purchased INTEGER NOT NULL DEFAULT 0,
  lifetime_used INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_balances_org ON credit_balances(organization_id);

-- Transaction history for auditing
CREATE TABLE IF NOT EXISTS credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('PURCHASE', 'DEDUCT', 'REFUND', 'BONUS', 'ADJUSTMENT')),
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  description TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_org ON credit_transactions(organization_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_created ON credit_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_type ON credit_transactions(type);

-- Cost definitions per action and tier (allows easy adjustment)
CREATE TABLE IF NOT EXISTS credit_costs (
  action TEXT NOT NULL,
  tier TEXT NOT NULL,
  cost INTEGER NOT NULL,
  PRIMARY KEY (action, tier)
);

-- Seed default costs (tier-specific surcharges)
-- FREE tier pays more per action (encourages upgrade)
-- ENTERPRISE tier gets best rates (volume discount)
INSERT INTO credit_costs (action, tier, cost) VALUES
  -- SMS sending costs (FREE pays 5, PRO pays 3, ENTERPRISE pays 2)
  ('SMS_SEND', 'FREE', 5),
  ('SMS_SEND', 'STARTER', 4),
  ('SMS_SEND', 'PRO', 3),
  ('SMS_SEND', 'BUSINESS', 2),
  ('SMS_SEND', 'ENTERPRISE', 2),

  -- Email sending costs (cheaper than SMS)
  ('EMAIL_SEND', 'FREE', 2),
  ('EMAIL_SEND', 'STARTER', 2),
  ('EMAIL_SEND', 'PRO', 1),
  ('EMAIL_SEND', 'BUSINESS', 1),
  ('EMAIL_SEND', 'ENTERPRISE', 1),

  -- AI request costs (most expensive action)
  ('AI_REQUEST', 'FREE', 10),
  ('AI_REQUEST', 'STARTER', 8),
  ('AI_REQUEST', 'PRO', 5),
  ('AI_REQUEST', 'BUSINESS', 4),
  ('AI_REQUEST', 'ENTERPRISE', 3),

  -- AI negotiation (complex multi-turn)
  ('AI_NEGOTIATION', 'FREE', 25),
  ('AI_NEGOTIATION', 'STARTER', 20),
  ('AI_NEGOTIATION', 'PRO', 12),
  ('AI_NEGOTIATION', 'BUSINESS', 10),
  ('AI_NEGOTIATION', 'ENTERPRISE', 8),

  -- Contract generation
  ('CONTRACT_GENERATE', 'FREE', 15),
  ('CONTRACT_GENERATE', 'STARTER', 12),
  ('CONTRACT_GENERATE', 'PRO', 8),
  ('CONTRACT_GENERATE', 'BUSINESS', 6),
  ('CONTRACT_GENERATE', 'ENTERPRISE', 5),

  -- Lead finder (bulk operations)
  ('LEAD_FIND', 'FREE', 3),
  ('LEAD_FIND', 'STARTER', 2),
  ('LEAD_FIND', 'PRO', 1),
  ('LEAD_FIND', 'BUSINESS', 1),
  ('LEAD_FIND', 'ENTERPRISE', 1)
ON CONFLICT (action, tier) DO UPDATE SET cost = EXCLUDED.cost;

-- Create credit balance on organization creation (trigger)
CREATE OR REPLACE FUNCTION create_credit_balance_for_org()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO credit_balances (organization_id, balance, lifetime_purchased, lifetime_used)
  VALUES (NEW.id, 0, 0, 0)
  ON CONFLICT (organization_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_create_credit_balance ON organizations;
CREATE TRIGGER trg_create_credit_balance
  AFTER INSERT ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION create_credit_balance_for_org();

-- Backfill credit balances for existing organizations
INSERT INTO credit_balances (organization_id, balance, lifetime_purchased, lifetime_used)
SELECT id, 0, 0, 0 FROM organizations
WHERE id NOT IN (SELECT organization_id FROM credit_balances)
ON CONFLICT (organization_id) DO NOTHING;
