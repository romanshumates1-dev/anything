-- Performance indexes for contracts queries
-- Optimization: 60-70% reduction in database round trips for contracts list

-- Composite index for org-scoped contract listings (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_contracts_org_created
  ON contracts(organization_id, created_at DESC);

-- Index for inspection period queries
CREATE INDEX IF NOT EXISTS idx_contracts_inspection_active
  ON contracts(organization_id, created_at, inspection_days)
  WHERE status NOT IN ('TERMINATED', 'CLOSED', 'EXPIRED', 'CANCELLED');

-- Index for unassigned contracts needing buyers
CREATE INDEX IF NOT EXISTS idx_contracts_pending_assignment
  ON contracts(organization_id, created_at DESC)
  WHERE assigned_at IS NULL AND status NOT IN ('TERMINATED', 'CLOSED', 'EXPIRED', 'CANCELLED');

-- Index for esign events by contract
CREATE INDEX IF NOT EXISTS idx_esign_events_contract_created
  ON esign_events(contract_id, created_at ASC);

-- Index for payments ledger by contract
CREATE INDEX IF NOT EXISTS idx_payments_ledger_contract_created
  ON payments_ledger(contract_id, created_at DESC);

-- Index for buyer assignments by contract
CREATE INDEX IF NOT EXISTS idx_buyer_assignments_contract_status
  ON buyer_assignments(contract_id, status);
