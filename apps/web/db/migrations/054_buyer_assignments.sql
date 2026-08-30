-- Buyer assignment tracking for deal assignment pipeline
CREATE TABLE IF NOT EXISTS buyer_assignments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL,
  lead_id INTEGER NOT NULL REFERENCES leads(id),
  buyer_id INTEGER NOT NULL REFERENCES buyers(id),
  contract_id TEXT REFERENCES contracts(id),
  match_score INTEGER DEFAULT 0,
  status TEXT DEFAULT 'PENDING_BUYER_ACCEPT',
  assignment_fee_cents INTEGER,
  buyer_accepted_at TIMESTAMPTZ,
  contract_sent_at TIMESTAMPTZ,
  contract_signed_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_buyer_assignments_org ON buyer_assignments(organization_id);
CREATE INDEX IF NOT EXISTS idx_buyer_assignments_lead ON buyer_assignments(lead_id);
CREATE INDEX IF NOT EXISTS idx_buyer_assignments_buyer ON buyer_assignments(buyer_id);
CREATE INDEX IF NOT EXISTS idx_buyer_assignments_status ON buyer_assignments(status);

-- Add buyer_id to contracts if not exists
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS buyer_id INTEGER REFERENCES buyers(id);
