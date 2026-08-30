-- Migration 065: Spam Detection and Prospect Recycling Tables
-- Supports: spamDetectionEngine.ts, prospectRecyclingEngine.ts

-- Spam offenses tracking
CREATE TABLE IF NOT EXISTS spam_offenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id),
  contact_id VARCHAR(64) NOT NULL,
  category VARCHAR(50) NOT NULL,
  message_preview TEXT,
  channel VARCHAR(20),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spam_offenses_contact
  ON spam_offenses(organization_id, contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_spam_offenses_category
  ON spam_offenses(category, created_at DESC);

-- Message hashes for repeat detection
CREATE TABLE IF NOT EXISTS spam_message_hashes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR(64) NOT NULL,
  contact_id VARCHAR(64) NOT NULL,
  message_hash VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spam_hashes_lookup
  ON spam_message_hashes(organization_id, contact_id, message_hash, created_at DESC);

-- Contact blacklist
CREATE TABLE IF NOT EXISTS contact_blacklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id),
  contact_id VARCHAR(64) NOT NULL,
  reason VARCHAR(100) NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_blacklist_org
  ON contact_blacklist(organization_id);

-- Lead fingerprints for deduplication
CREATE TABLE IF NOT EXISTS lead_fingerprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id),
  lead_id VARCHAR(64) NOT NULL,
  fingerprint_type VARCHAR(20) NOT NULL CHECK (fingerprint_type IN ('email', 'phone', 'address', 'source_id')),
  fingerprint_value VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, fingerprint_type, fingerprint_value)
);

CREATE INDEX IF NOT EXISTS idx_fingerprints_lookup
  ON lead_fingerprints(organization_id, fingerprint_type, fingerprint_value);
CREATE INDEX IF NOT EXISTS idx_fingerprints_lead
  ON lead_fingerprints(lead_id);

-- Add blacklist columns to leads if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'is_blacklisted') THEN
    ALTER TABLE leads ADD COLUMN is_blacklisted BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'blacklisted_at') THEN
    ALTER TABLE leads ADD COLUMN blacklisted_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'blacklist_reason') THEN
    ALTER TABLE leads ADD COLUMN blacklist_reason VARCHAR(255);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'recycled_count') THEN
    ALTER TABLE leads ADD COLUMN recycled_count INTEGER DEFAULT 0;
  END IF;
END $$;

-- Add recycling columns to campaign_lead_queue if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'campaign_lead_queue' AND column_name = 'is_recycled') THEN
    ALTER TABLE campaign_lead_queue ADD COLUMN is_recycled BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'campaign_lead_queue' AND column_name = 'recycled_at') THEN
    ALTER TABLE campaign_lead_queue ADD COLUMN recycled_at TIMESTAMPTZ;
  END IF;
END $$;

-- Indexes for blacklist lookups
CREATE INDEX IF NOT EXISTS idx_leads_blacklisted
  ON leads(organization_id, is_blacklisted) WHERE is_blacklisted = true;
CREATE INDEX IF NOT EXISTS idx_leads_recycled
  ON leads(organization_id, recycled_count) WHERE recycled_count > 0;
