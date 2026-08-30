-- Add buyer_id to contracts table for direct buyer assignment tracking
-- Code in buyers/match/route.ts sets this when auto-assigning buyers

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS buyer_id INTEGER REFERENCES buyers(id);

-- Create index for buyer lookup on contracts
CREATE INDEX IF NOT EXISTS idx_contracts_buyer ON contracts(buyer_id);

-- Add missing indexes for buyer_assignments performance
CREATE INDEX IF NOT EXISTS idx_buyer_assignments_org ON buyer_assignments(organization_id);
CREATE INDEX IF NOT EXISTS idx_buyer_assignments_lead ON buyer_assignments(lead_id);
CREATE INDEX IF NOT EXISTS idx_buyer_assignments_buyer ON buyer_assignments(buyer_id);
CREATE INDEX IF NOT EXISTS idx_buyer_assignments_status ON buyer_assignments(status);
