-- 082_negotiation_automation.sql
-- Automated AI Negotiation Engine: configuration columns and queue tables
-- Enables 90%+ automated handling of counter-offers within configured bounds
-- Idempotent. Rollback: DROP columns and table.

-- Add negotiation-specific columns to pipeline_config
ALTER TABLE public.pipeline_config
  ADD COLUMN IF NOT EXISTS negotiation_strategy TEXT DEFAULT 'balanced'
    CHECK (negotiation_strategy IN ('aggressive', 'balanced', 'conservative')),
  ADD COLUMN IF NOT EXISTS negotiation_escalate_over_cents INTEGER DEFAULT 50000000, -- $500k
  ADD COLUMN IF NOT EXISTS negotiation_max_rounds INTEGER DEFAULT 4 CHECK (negotiation_max_rounds BETWEEN 1 AND 10),
  ADD COLUMN IF NOT EXISTS negotiation_fee_floor_cents INTEGER DEFAULT 500000; -- $5k

COMMENT ON COLUMN public.pipeline_config.negotiation_strategy IS
  'aggressive = smaller concessions, balanced = industry standard, conservative = more deals closed';

COMMENT ON COLUMN public.pipeline_config.negotiation_escalate_over_cents IS
  'Deals exceeding this value are escalated for human review regardless of bounds';

COMMENT ON COLUMN public.pipeline_config.negotiation_max_rounds IS
  'Maximum negotiation rounds before system walks away (1-10)';

COMMENT ON COLUMN public.pipeline_config.negotiation_fee_floor_cents IS
  'Organization-level override for minimum acceptable fee. Default $5,000.';

-- Add strategy and auto-thresholds to negotiation_sessions
ALTER TABLE public.negotiation_sessions
  ADD COLUMN IF NOT EXISTS strategy TEXT DEFAULT 'balanced'
    CHECK (strategy IN ('aggressive', 'balanced', 'conservative')),
  ADD COLUMN IF NOT EXISTS auto_approve_under_cents BIGINT DEFAULT 10000000, -- $100k
  ADD COLUMN IF NOT EXISTS escalate_over_cents BIGINT DEFAULT 50000000, -- $500k
  ADD COLUMN IF NOT EXISTS max_rounds INTEGER DEFAULT 4,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC(3,2) DEFAULT 0.80,
  ADD COLUMN IF NOT EXISTS escalation_reason TEXT,
  ADD COLUMN IF NOT EXISTS last_ai_response TEXT,
  ADD COLUMN IF NOT EXISTS message_count INTEGER DEFAULT 0;

-- Negotiation queue for processing inbound counter-offers
-- Distinct from negotiation_sessions which tracks the state machine
CREATE TABLE IF NOT EXISTS public.negotiation_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id BIGINT NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  organization_id TEXT,
  inbound_message TEXT NOT NULL,
  sentiment TEXT,
  session_id TEXT REFERENCES public.negotiation_sessions(id) ON DELETE SET NULL,
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMPTZ,
  outcome TEXT, -- 'counter_sent', 'accepted', 'escalated', 'walked_away', 'error'
  outcome_details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_negotiation_queue_unprocessed
  ON public.negotiation_queue(created_at)
  WHERE processed = FALSE;

CREATE INDEX IF NOT EXISTS idx_negotiation_queue_lead
  ON public.negotiation_queue(lead_id, created_at DESC);

COMMENT ON TABLE public.negotiation_queue IS
  'Queue for processing inbound messages that may contain counter-offers';

-- Negotiation events for audit trail and analytics
CREATE TABLE IF NOT EXISTS public.negotiation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id TEXT NOT NULL,
  lead_id BIGINT REFERENCES public.leads(id) ON DELETE SET NULL,
  session_id TEXT REFERENCES public.negotiation_sessions(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL, -- 'counter_received', 'counter_sent', 'accepted', 'escalated', 'walked_away', 'price_extracted'
  event_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_negotiation_events_session
  ON public.negotiation_events(session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_negotiation_events_org
  ON public.negotiation_events(organization_id, created_at DESC);

COMMENT ON TABLE public.negotiation_events IS
  'Audit trail of all negotiation events for analytics and debugging';

-- Add action type for negotiation unparseable
-- (Using DO block to handle if CHECK constraint needs updating)
DO $$
BEGIN
  -- Check if NEGOTIATION_UNPARSEABLE is already in the constraint
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name LIKE '%human_approvals%'
      AND check_clause LIKE '%NEGOTIATION_UNPARSEABLE%'
  ) THEN
    -- The human_approvals table uses free-form TEXT type column, so no constraint update needed
    NULL;
  END IF;
END $$;
