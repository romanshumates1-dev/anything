-- Migration 061: Stalled Conversation Recovery Engine
-- Tracks re-engagement attempts for conversations that went cold mid-conversation
-- (distinct from resurrection which handles 30-180 day old cold leads)

-- Log table for stalled conversation recovery attempts
CREATE TABLE IF NOT EXISTS stalled_conversation_log (
  id SERIAL PRIMARY KEY,
  organization_id TEXT NOT NULL,
  lead_id INTEGER NOT NULL REFERENCES leads(id),
  stall_level TEXT NOT NULL CHECK (stall_level IN ('softCheckIn', 'valueReinforce', 'lastChance')),
  hours_stalled INTEGER NOT NULL,
  template_used TEXT NOT NULL,
  response_received BOOLEAN DEFAULT false,
  response_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for finding recent re-engagement attempts (dedup)
CREATE INDEX IF NOT EXISTS idx_stalled_log_lead_recent
  ON stalled_conversation_log(lead_id, created_at DESC);

-- Index for org-level reporting
CREATE INDEX IF NOT EXISTS idx_stalled_log_org_date
  ON stalled_conversation_log(organization_id, created_at DESC);

-- Add stalled conversation config to organization settings if not exists
-- (organization_settings table may already have a JSONB column for this)
DO $$
BEGIN
  -- Check if organization_settings exists and add column if needed
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'organization_settings') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'organization_settings'
      AND column_name = 'stalled_conversation_config'
    ) THEN
      ALTER TABLE organization_settings
        ADD COLUMN stalled_conversation_config JSONB DEFAULT '{}';
    END IF;
  END IF;
END $$;

-- Add the stalledConversation beta flag
INSERT INTO beta_flags (key, enabled, description, created_at)
VALUES ('stalledConversation', false, 'Stalled Conversation Recovery: Re-engage leads that replied but went silent', now())
ON CONFLICT (key) DO NOTHING;
