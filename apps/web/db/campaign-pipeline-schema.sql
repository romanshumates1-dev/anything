-- ============================================================================
-- Campaign Pipeline Schema Extensions (Phase 1)
-- Adds tables for wholesaling automation: campaigns, contacts, scheduling,
-- negotiation price ladders, owner range requests, contracts.
-- ============================================================================

-- Campaign direction + status enums
CREATE TYPE campaign_direction AS ENUM ('SELLER', 'BUYER');
CREATE TYPE campaign_status AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');
CREATE TYPE contact_status AS ENUM (
  'QUEUED', 'SENT', 'FOLLOWED_UP', 'ENGAGED', 'NEGOTIATING',
  'AWAITING_OWNER_RANGE', 'DEAL_AGREED', 'DEAL_NO_AGREEMENT',
  'CONTRACT_SENT', 'CONTRACT_SIGNED', 'OPTED_OUT', 'COLD', 'INVALID_NUMBER'
);
CREATE TYPE owner_range_request_status AS ENUM ('PENDING', 'ANSWERED', 'EXPIRED');
CREATE TYPE message_template_kind AS ENUM ('OPENING', 'FOLLOW_UP');

-- Outreach campaigns
CREATE TABLE IF NOT EXISTS public.outreach_campaigns (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  direction campaign_direction NOT NULL,
  name text NOT NULL,
  status campaign_status NOT NULL DEFAULT 'DRAFT',
  daily_volume_min integer NOT NULL DEFAULT 50,
  daily_volume_max integer NOT NULL,
  duration_days integer NOT NULL,
  start_date timestamptz,
  end_date timestamptz,
  opening_message_id text NOT NULL,
  linked_seller_lead_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_outreach_campaigns_org_status ON public.outreach_campaigns (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_outreach_campaigns_org_direction ON public.outreach_campaigns (organization_id, direction);

-- Message templates (opening + follow-ups per campaign)
CREATE TABLE IF NOT EXISTS public.campaign_message_templates (
  id text PRIMARY KEY,
  campaign_id text,
  organization_id text NOT NULL,
  kind message_template_kind NOT NULL,
  sequence_order integer NOT NULL DEFAULT 0,
  delay_hours integer NOT NULL DEFAULT 24,
  body text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_campaign_message_templates_campaign ON public.campaign_message_templates (campaign_id);

-- Campaign contacts (one row per lead in a campaign)
CREATE TABLE IF NOT EXISTS public.campaign_contacts (
  id text PRIMARY KEY,
  campaign_id text NOT NULL REFERENCES public.outreach_campaigns(id) ON DELETE CASCADE,
  organization_id text NOT NULL,
  name text NOT NULL,
  phone text NOT NULL,
  status contact_status NOT NULL DEFAULT 'QUEUED',
  follow_ups_sent integer NOT NULL DEFAULT 0,
  last_message_at timestamptz,
  last_reply_at timestamptz,
  scheduled_send_at timestamptz,
  opted_out_at timestamptz,
  seller_lead_id text,
  buyer_lead_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_campaign_contact ON public.campaign_contacts (campaign_id, phone);
CREATE INDEX IF NOT EXISTS idx_campaign_contacts_org_status ON public.campaign_contacts (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_campaign_contacts_campaign_status ON public.campaign_contacts (campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_campaign_contacts_scheduled_send ON public.campaign_contacts (scheduled_send_at);

-- Daily send log (tracks against daily volume cap)
CREATE TABLE IF NOT EXISTS public.campaign_daily_send_logs (
  id text PRIMARY KEY,
  campaign_id text NOT NULL REFERENCES public.outreach_campaigns(id) ON DELETE CASCADE,
  date date NOT NULL,
  sent_count integer NOT NULL DEFAULT 0,
  target_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_campaign_daily_log ON public.campaign_daily_send_logs (campaign_id, date);

-- Negotiation price ladders (4-tier price ranges per negotiation)
CREATE TABLE IF NOT EXISTS public.negotiation_price_ranges (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  negotiation_id text NOT NULL UNIQUE,
  direction campaign_direction NOT NULL,
  min_price integer NOT NULL,
  max_price integer NOT NULL,
  tier1_price integer NOT NULL,
  tier2_price integer NOT NULL,
  tier3_price integer NOT NULL,
  tier4_price integer NOT NULL,
  current_tier integer NOT NULL DEFAULT 1,
  owner_responded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_negotiation_price_ranges_org ON public.negotiation_price_ranges (organization_id);

-- Owner range requests (pending/answered/expired)
CREATE TABLE IF NOT EXISTS public.owner_range_requests (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  negotiation_id text NOT NULL UNIQUE,
  direction campaign_direction NOT NULL,
  property_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  status owner_range_request_status NOT NULL DEFAULT 'PENDING',
  requested_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  answered_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_owner_range_requests_org_status ON public.owner_range_requests (organization_id, status);

-- Contract templates (attorney-reviewed legal boilerplate with merge fields)
CREATE TABLE IF NOT EXISTS public.contract_templates (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  direction campaign_direction NOT NULL,
  template_body text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Contracts (filled + sent for signature)
CREATE TABLE IF NOT EXISTS public.contracts (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  template_id text NOT NULL REFERENCES public.contract_templates(id),
  direction campaign_direction NOT NULL,
  seller_lead_id text,
  filled_body text NOT NULL,
  pdf_url text,
  status text NOT NULL DEFAULT 'PENDING_SIGNATURE',
  signed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contracts_org ON public.contracts (organization_id);

-- Human approval gate (contract send requires owner approval)
CREATE TABLE IF NOT EXISTS public.human_approvals (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  type text NOT NULL,
  negotiation_id text,
  contract_id text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'PENDING',
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timimestz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_human_approvals_org_status ON public.human_approvals (organization_id, status);