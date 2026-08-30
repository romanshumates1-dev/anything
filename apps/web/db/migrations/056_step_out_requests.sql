-- Step-out requests table for contract inspection period cancellations
-- Created as proper migration instead of inline CREATE TABLE fallback

CREATE TABLE IF NOT EXISTS step_out_requests (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  party TEXT NOT NULL CHECK (party IN ('seller', 'buyer')),
  reason TEXT,
  confirmation_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'expired', 'cancelled')),
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_step_out_requests_contract ON step_out_requests(contract_id);
CREATE INDEX IF NOT EXISTS idx_step_out_requests_token ON step_out_requests(confirmation_token);
CREATE INDEX IF NOT EXISTS idx_step_out_requests_org ON step_out_requests(organization_id);
CREATE INDEX IF NOT EXISTS idx_step_out_requests_expires ON step_out_requests(expires_at) WHERE status = 'pending';
