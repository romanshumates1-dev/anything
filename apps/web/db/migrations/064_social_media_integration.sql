-- Migration 064: Social Media Integration Tables
-- Supports: socialMediaEngine.ts

-- Social media accounts (Instagram, Facebook, TikTok, Twitter)
CREATE TABLE IF NOT EXISTS social_media_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id),
  platform VARCHAR(20) NOT NULL CHECK (platform IN ('instagram', 'facebook', 'tiktok', 'twitter')),
  platform_account_id VARCHAR(255) NOT NULL,
  account_name VARCHAR(255) NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  webhook_secret VARCHAR(255),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, platform, platform_account_id)
);

CREATE INDEX IF NOT EXISTS idx_social_accounts_org_platform
  ON social_media_accounts(organization_id, platform);

-- Social contacts (people who message us on social)
CREATE TABLE IF NOT EXISTS social_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id),
  platform VARCHAR(20) NOT NULL CHECK (platform IN ('instagram', 'facebook', 'tiktok', 'twitter')),
  platform_user_id VARCHAR(255) NOT NULL,
  platform_username VARCHAR(255),
  display_name VARCHAR(255),
  profile_url TEXT,
  lead_id INTEGER REFERENCES leads(id),
  pipeline_status VARCHAR(20) NOT NULL DEFAULT 'new'
    CHECK (pipeline_status IN ('new', 'contacted', 'engaged', 'qualified', 'converted', 'lost')),
  last_message_at TIMESTAMPTZ,
  message_count INTEGER NOT NULL DEFAULT 0,
  is_blacklisted BOOLEAN NOT NULL DEFAULT false,
  blacklisted_at TIMESTAMPTZ,
  blacklist_reason VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, platform, platform_user_id)
);

CREATE INDEX IF NOT EXISTS idx_social_contacts_org
  ON social_contacts(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_contacts_platform
  ON social_contacts(platform, pipeline_status);
CREATE INDEX IF NOT EXISTS idx_social_contacts_lead
  ON social_contacts(lead_id) WHERE lead_id IS NOT NULL;

-- Social messages (DMs, comments, mentions)
CREATE TABLE IF NOT EXISTS social_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR(64) NOT NULL REFERENCES organizations(id),
  social_contact_id UUID NOT NULL REFERENCES social_contacts(id),
  platform VARCHAR(20) NOT NULL CHECK (platform IN ('instagram', 'facebook', 'tiktok', 'twitter')),
  message_type VARCHAR(20) NOT NULL CHECK (message_type IN ('dm', 'comment', 'mention', 'story_reply')),
  platform_message_id VARCHAR(255),
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  content TEXT NOT NULL,
  media_urls JSONB,
  parent_post_id VARCHAR(255),
  platform_timestamp TIMESTAMPTZ,
  ai_generated BOOLEAN DEFAULT false,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_social_messages_contact
  ON social_messages(social_contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_messages_org_platform
  ON social_messages(organization_id, platform, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_messages_direction
  ON social_messages(direction, created_at DESC);

-- Add social columns to leads table if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'social_platform') THEN
    ALTER TABLE leads ADD COLUMN social_platform VARCHAR(20);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'social_username') THEN
    ALTER TABLE leads ADD COLUMN social_username VARCHAR(255);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'social_profile_url') THEN
    ALTER TABLE leads ADD COLUMN social_profile_url TEXT;
  END IF;
END $$;
