-- Migration 063: Support Interactions and Call Scheduling Tables
-- Supports: simplifierEngine.ts, callSchedulingEngine.ts

-- Support interactions tracking
CREATE TABLE IF NOT EXISTS support_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id),
  topic VARCHAR(100) NOT NULL,
  original_question TEXT NOT NULL,
  simplified_response TEXT NOT NULL,
  context VARCHAR(20) NOT NULL CHECK (context IN ('seller', 'buyer')),
  helpful_rating SMALLINT CHECK (helpful_rating BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_interactions_org
  ON support_interactions(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_interactions_lead
  ON support_interactions(lead_id);
CREATE INDEX IF NOT EXISTS idx_support_interactions_topic
  ON support_interactions(topic);

-- Scheduled calls tracking
CREATE TABLE IF NOT EXISTS scheduled_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id VARCHAR(64) NOT NULL,
  organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id),
  contact_id VARCHAR(64),
  context VARCHAR(20) NOT NULL CHECK (context IN ('seller', 'buyer')),
  reason TEXT NOT NULL,
  availability_text JSONB,
  preferred_time_text TEXT,
  requested_time TIMESTAMPTZ,
  scheduled_time TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'scheduled', 'completed', 'cancelled', 'no_show')),
  owner_notified BOOLEAN NOT NULL DEFAULT false,
  notified_at TIMESTAMPTZ,
  lead_phone VARCHAR(20),
  lead_email VARCHAR(255),
  lead_name VARCHAR(255) NOT NULL,
  property_address TEXT,
  notes TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_calls_org_status
  ON scheduled_calls(organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scheduled_calls_lead
  ON scheduled_calls(lead_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_calls_pending
  ON scheduled_calls(status, created_at DESC) WHERE status = 'pending';
