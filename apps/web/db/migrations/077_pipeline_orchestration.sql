-- 077_pipeline_orchestration.sql
-- Pipeline orchestration: action queue for minimal human interaction
-- Design: AI runs everything, humans only intervene when genuinely beneficial
-- Idempotent. Rollback: DROP TABLE action_queue, pipeline_runs, pipeline_config, notification_batches;

-- Action queue: items requiring human attention
CREATE TABLE IF NOT EXISTS public.action_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id TEXT NOT NULL,
  user_id TEXT, -- assigned to specific user (null = any org user)

  -- Action classification
  type TEXT NOT NULL CHECK (type IN (
    'REVIEW_DEAL',           -- Deal exceeds auto-approval threshold
    'APPROVE_CONTRACT',      -- Contract ready for final approval
    'CONFIRM_CLOSING',       -- Deal closed, confirm payment release
    'REVIEW_RESPONSE',       -- AI flagged response needs human review
    'ESCALATION',            -- System escalated for human intervention
    'CAMPAIGN_SETUP',        -- New campaign needs configuration
    'EXCEPTION'              -- Unexpected situation needs attention
  )),

  priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),

  -- Entity reference
  entity_type TEXT, -- lead, deal, contract, campaign, conversation
  entity_id TEXT,

  -- Display
  title TEXT NOT NULL,
  description TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,

  -- Quick actions (JSON array of possible actions)
  -- e.g. [{"action":"approve","label":"Approve"},{"action":"reject","label":"Reject"}]
  quick_actions JSONB DEFAULT '[]'::jsonb,

  -- State
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING',      -- Awaiting action
    'IN_PROGRESS',  -- User is reviewing
    'COMPLETED',    -- Action taken
    'SKIPPED',      -- User skipped (with reason)
    'AUTO_CONTINUED', -- System auto-proceeded (for low-risk items)
    'EXPIRED'       -- Due date passed without action
  )),

  -- Auto-continue config
  auto_continue_at TIMESTAMPTZ,  -- If set, system can auto-proceed after this time
  auto_continue_action TEXT,     -- What action to take if auto-continuing

  -- Timing
  due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  completed_by TEXT,  -- user who completed

  -- Result
  result_action TEXT,  -- What action was taken
  result_notes TEXT    -- Optional notes from user
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_action_queue_org_pending
  ON public.action_queue(organization_id, status, priority DESC, created_at)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_action_queue_user_pending
  ON public.action_queue(user_id, status, priority DESC)
  WHERE status = 'PENDING' AND user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_action_queue_auto_continue
  ON public.action_queue(auto_continue_at)
  WHERE status = 'PENDING' AND auto_continue_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_action_queue_entity
  ON public.action_queue(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_action_queue_due
  ON public.action_queue(due_at)
  WHERE status = 'PENDING' AND due_at IS NOT NULL;

COMMENT ON TABLE public.action_queue IS 'Human action items - only things that genuinely need human attention';

-- Pipeline runs: track each orchestration cycle
CREATE TABLE IF NOT EXISTS public.pipeline_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id TEXT NOT NULL,

  -- Run timing
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,

  -- Stats per stage
  stage_stats JSONB DEFAULT '{}'::jsonb,
  -- Example: {
  --   "lead_ingestion": {"processed": 50, "errors": 2, "duration_ms": 1234},
  --   "outreach": {"sent": 25, "deferred": 5, "suppressed": 3},
  --   "responses": {"classified": 10, "escalated": 1},
  --   "negotiations": {"advanced": 5, "walk_away": 1},
  --   "contracts": {"generated": 2, "sent": 1},
  --   "closings": {"completed": 1}
  -- }

  -- Outcomes
  leads_processed INTEGER DEFAULT 0,
  messages_sent INTEGER DEFAULT 0,
  responses_handled INTEGER DEFAULT 0,
  deals_advanced INTEGER DEFAULT 0,
  contracts_generated INTEGER DEFAULT 0,
  human_actions_created INTEGER DEFAULT 0,

  -- Error tracking
  errors JSONB DEFAULT '[]'::jsonb,

  status TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED', 'PARTIAL'))
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_org
  ON public.pipeline_runs(organization_id, started_at DESC);

COMMENT ON TABLE public.pipeline_runs IS 'Track each pipeline orchestration cycle for monitoring';

-- Pipeline configuration per organization
CREATE TABLE IF NOT EXISTS public.pipeline_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id TEXT NOT NULL UNIQUE,

  -- Auto-approval thresholds
  deal_auto_approve_max_cents INTEGER DEFAULT 10000000, -- $100k default
  contract_auto_send BOOLEAN DEFAULT FALSE, -- Require approval for contract sends

  -- Auto-continue settings (hours until system can auto-proceed)
  auto_continue_low_risk_hours INTEGER DEFAULT 24,
  auto_continue_normal_risk_hours INTEGER DEFAULT 48,
  auto_continue_enabled BOOLEAN DEFAULT TRUE,

  -- Notification preferences
  notification_mode TEXT DEFAULT 'BATCH' CHECK (notification_mode IN ('IMMEDIATE', 'BATCH', 'DIGEST')),
  digest_hour INTEGER DEFAULT 9 CHECK (digest_hour >= 0 AND digest_hour < 24), -- Hour to send daily digest (UTC)
  digest_timezone TEXT DEFAULT 'America/New_York',

  -- Channels enabled
  sms_notifications BOOLEAN DEFAULT TRUE,
  email_notifications BOOLEAN DEFAULT TRUE,
  push_notifications BOOLEAN DEFAULT FALSE,

  -- Pipeline stages enabled
  auto_lead_scoring BOOLEAN DEFAULT TRUE,
  auto_campaign_assignment BOOLEAN DEFAULT TRUE,
  auto_response_classification BOOLEAN DEFAULT TRUE,
  auto_negotiation BOOLEAN DEFAULT TRUE,
  auto_contract_generation BOOLEAN DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_config_org ON public.pipeline_config(organization_id);

COMMENT ON TABLE public.pipeline_config IS 'Per-org pipeline automation settings';

-- Notification batches for digest mode
CREATE TABLE IF NOT EXISTS public.notification_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id TEXT NOT NULL,
  user_id TEXT,

  -- Batch window
  batch_date DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Notifications in this batch
  notifications JSONB DEFAULT '[]'::jsonb,
  -- Example: [
  --   {"type": "deal_ready", "entity_id": "...", "title": "Deal ready for review", "created_at": "..."},
  --   {"type": "responses", "count": 5, "summary": "5 new responses received"}
  -- ]

  -- Delivery status
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
  sent_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_batches_pending
  ON public.notification_batches(batch_date, status)
  WHERE status = 'PENDING';

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_batches_unique
  ON public.notification_batches(organization_id, user_id, batch_date)
  WHERE user_id IS NOT NULL;

COMMENT ON TABLE public.notification_batches IS 'Batched notifications for daily digest delivery';

-- Insert default pipeline config for existing organizations
INSERT INTO public.pipeline_config (organization_id)
SELECT DISTINCT organization_id
FROM public.outreach_campaigns
WHERE organization_id NOT IN (SELECT organization_id FROM public.pipeline_config)
ON CONFLICT (organization_id) DO NOTHING;
