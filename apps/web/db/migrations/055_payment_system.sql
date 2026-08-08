-- Payment System Schema
-- Supports Stripe + Wire Transfer with enforcement

-- Payment records table
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  deal_id UUID NOT NULL,
  buyer_id UUID NOT NULL,

  -- Payment details
  amount_cents INTEGER NOT NULL,
  currency TEXT DEFAULT 'usd',
  method TEXT NOT NULL CHECK (method IN ('stripe', 'wire')),

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'pending', 'paid', 'failed', 'refunded')),

  -- Stripe fields
  stripe_payment_intent_id TEXT,
  stripe_client_secret TEXT,
  stripe_charge_id TEXT,

  -- Wire fields
  wire_reference_id TEXT,
  wire_proof_url TEXT,
  wire_verified_by UUID,
  wire_verified_at TIMESTAMPTZ,

  -- Metadata
  metadata JSONB DEFAULT '{}',
  failure_reason TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);

-- Payment audit log
CREATE TABLE IF NOT EXISTS payment_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES payments(id),
  event_type TEXT NOT NULL,
  event_data JSONB DEFAULT '{}',
  actor_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Wire instructions template
CREATE TABLE IF NOT EXISTS wire_instructions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  bank_name TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_number TEXT NOT NULL,
  routing_number TEXT,
  swift_code TEXT,
  bank_address TEXT,
  additional_instructions TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_payments_deal_id ON payments(deal_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_stripe_intent ON payments(stripe_payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_payment_audit_payment_id ON payment_audit_log(payment_id);

-- Seed default wire instructions
INSERT INTO wire_instructions (id, organization_id, bank_name, account_name, account_number, routing_number, swift_code, bank_address)
VALUES (
  'default-wire-001',
  '00000000-0000-0000-0000-000000000000',
  'Chase Bank',
  'DealSwift Automation LLC',
  '****7890',
  '021000021',
  'CHASUS33',
  '270 Park Avenue, New York, NY 10017'
) ON CONFLICT DO NOTHING;
