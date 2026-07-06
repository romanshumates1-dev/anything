-- ============================================================================
-- Phase 1 — Missing tables for GUI + API + Campaign optionality
-- ============================================================================

-- Multi-tenant orgs (1:1 with better-auth user for single-org owner, but supports future)
CREATE TABLE IF NOT EXISTS public.organizations (
  id text PRIMARY KEY,
  name text NOT NULL,
  owner_user_id text NOT NULL,
  timezone text NOT NULL DEFAULT 'America/New_York',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Contact lists / sources with consent flag
CREATE TABLE IF NOT EXISTS public.contact_lists (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  name text NOT NULL,
  source_type text NOT NULL DEFAULT 'csv', -- csv, paste, crm
  consent_mode text NOT NULL DEFAULT 'unverified', -- unverified, inbound, consented
  total_rows integer NOT NULL DEFAULT 0,
  inserted_rows integer NOT NULL DEFAULT 0,
  duplicate_rows integer NOT NULL DEFAULT 0,
  failed_rows integer NOT NULL DEFAULT 0,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contact_lists_org ON public.contact_lists (organization_id);

-- Verified test phone numbers (OTP-verified allowlist)
CREATE TABLE IF NOT EXISTS public.test_phone_numbers (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  phone text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  otp_code text,
  otp_expires_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_test_phone_org ON public.test_phone_numbers (organization_id, phone);

-- API keys (hashed at rest)
CREATE TABLE IF NOT EXISTS public.api_keys (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  name text NOT NULL,
  key_hash text NOT NULL,
  prefix text NOT NULL, -- df_live_ / df_test_
  scopes text[] NOT NULL DEFAULT '{}',
  rate_limit_per_min integer NOT NULL DEFAULT 120,
  last_used_at timestamptz,
  usage_count integer NOT NULL DEFAULT 0,
  revoked boolean NOT NULL DEFAULT false,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_keys_org ON public.api_keys (organization_id);

-- DNC / compliance toggle audit
CREATE TABLE IF NOT EXISTS public.compliance_audit (
  id serial PRIMARY KEY,
  organization_id text NOT NULL,
  campaign_id text,
  action text NOT NULL, -- dnc_scrub_disabled, litigator_scrub_disabled
  user_id text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_compliance_audit_org ON public.compliance_audit (organization_id);

-- Extend outreach_campaigns with optionality columns
ALTER TABLE public.outreach_campaigns
  ADD COLUMN IF NOT EXISTS daily_volume_min integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS daily_volume_max integer,
  ADD COLUMN IF NOT EXISTS duration_days integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS start_date timestamptz,
  ADD COLUMN IF NOT EXISTS end_date timestamptz,
  ADD COLUMN IF NOT EXISTS opening_message_id text,
  ADD COLUMN IF NOT EXISTS linked_seller_lead_id text,
  ADD COLUMN IF NOT EXISTS timezone text,
  ADD COLUMN IF NOT EXISTS send_window_start time,
  ADD COLUMN IF NOT EXISTS send_window_end time,
  ADD COLUMN IF NOT EXISTS test_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dnc_scrub_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS litigator_scrub_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ai_negotiation_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ai_valuation_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS resurrection_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ab_variants_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS budget_cap numeric,
  ADD COLUMN IF NOT EXISTS consent_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS consent_user_id text;

-- Ensure insertion of follow-ups references a valid campaign and org
ALTER TABLE public.campaign_message_templates
  ADD COLUMN IF NOT EXISTS name text;

-- Add ab_variant column to campaign_message_templates
ALTER TABLE public.campaign_message_templates
  ADD COLUMN IF NOT EXISTS ab_variant text DEFAULT 'A';

-- Conversation / message events for analytics and history
CREATE TABLE IF NOT EXISTS public.message_events (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  campaign_id text NOT NULL REFERENCES public.outreach_campaigns(id) ON DELETE CASCADE,
  contact_id text NOT NULL REFERENCES public.campaign_contacts(id) ON DELETE CASCADE,
  direction text NOT NULL, -- outbound/inbound
  provider text,
  provider_message_id text,
  status text NOT NULL DEFAULT 'queued',
  segment_count integer NOT NULL DEFAULT 1,
  cost_cents integer NOT NULL DEFAULT 0,
  ai_cost_cents integer NOT NULL DEFAULT 0,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_message_events_campaign ON public.message_events (campaign_id);
CREATE INDEX IF NOT EXISTS idx_message_events_contact ON public.message_events (contact_id);

-- Webhook subscriptions for API customers
CREATE TABLE IF NOT EXISTS public.webhooks (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  url text NOT NULL,
  secret text NOT NULL,
  events text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  last_delivery_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhooks_org ON public.webhooks (organization_id);

-- Webhook delivery log
CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
  id text PRIMARY KEY,
  webhook_id text NOT NULL REFERENCES public.webhooks(id) ON DELETE CASCADE,
  event text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status_code integer,
  response_body text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON public.webhook_deliveries (webhook_id);