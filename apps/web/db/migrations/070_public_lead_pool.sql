-- ============================================================================
-- Migration 070 — Public Lead Pool with Global Outreach Tracking
--
-- Creates a shared lead pool where:
-- 1. All users can access public-sourced leads (tax delinquent, pre-foreclosure, etc.)
-- 2. When a user outreaches to a lead, it's globally marked as "contacted"
-- 3. Other users see which leads have been contacted and by whom
-- 4. Prevents multiple users from blowing up the same leads
--
-- Privacy: Only shows that lead was contacted, not by whom specifically
-- (unless org opts in to show details for internal dedup)
-- ============================================================================

BEGIN;

-- Public lead pool - shared across all users/orgs
-- Unlike sourced_leads (org-scoped), this is a global pool
CREATE TABLE IF NOT EXISTS public.public_lead_pool (
  id serial PRIMARY KEY,

  -- Property identification (dedupe key components)
  property_address text NOT NULL,
  city text,
  state_code char(2),
  zip_code varchar(10),
  county text,
  parcel_id text,

  -- Owner info (public record)
  owner_name text,
  mailing_address text,

  -- Lead characteristics
  source_type text NOT NULL, -- tax_delinquent, pre_foreclosure, probate, code_violation, etc.
  distress_score integer NOT NULL DEFAULT 50,
  assessed_value_cents bigint,
  estimated_equity_cents bigint,
  signals jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Metadata
  source_id text, -- reference to public data source
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_data jsonb,

  -- Timestamps
  sourced_at timestamptz NOT NULL DEFAULT now(),
  last_refreshed_at timestamptz,

  -- Global dedupe - property_address + zip_code + owner_name
  dedupe_hash text NOT NULL UNIQUE
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_public_lead_pool_location
  ON public.public_lead_pool(state_code, county);
CREATE INDEX IF NOT EXISTS idx_public_lead_pool_source
  ON public.public_lead_pool(source_type);
CREATE INDEX IF NOT EXISTS idx_public_lead_pool_score
  ON public.public_lead_pool(distress_score DESC);
CREATE INDEX IF NOT EXISTS idx_public_lead_pool_zip
  ON public.public_lead_pool(zip_code);

-- Global outreach tracking - marks when any user contacts a lead
CREATE TABLE IF NOT EXISTS public.lead_outreach_log (
  id serial PRIMARY KEY,

  -- Which lead was contacted
  public_lead_id integer NOT NULL REFERENCES public.public_lead_pool(id) ON DELETE CASCADE,

  -- Who contacted (for internal tracking, not displayed to others)
  user_id text NOT NULL REFERENCES public."user"(id) ON DELETE SET NULL,
  organization_id uuid,

  -- Outreach details
  channel text NOT NULL, -- 'sms', 'email', 'call', 'mail'
  campaign_id text, -- if part of a campaign

  -- Timestamp
  outreached_at timestamptz NOT NULL DEFAULT now(),

  -- Unique constraint: same user can't log multiple outreaches to same lead
  UNIQUE(public_lead_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_outreach_log_lead
  ON public.lead_outreach_log(public_lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_outreach_log_user
  ON public.lead_outreach_log(user_id);
CREATE INDEX IF NOT EXISTS idx_lead_outreach_log_time
  ON public.lead_outreach_log(outreached_at DESC);

-- View for lead pool with outreach status
-- Shows count of users who contacted, not who specifically
CREATE OR REPLACE VIEW public.public_leads_with_status AS
SELECT
  p.*,
  COALESCE(o.outreach_count, 0) as outreach_count,
  o.first_outreach_at,
  o.last_outreach_at,
  CASE
    WHEN COALESCE(o.outreach_count, 0) = 0 THEN 'fresh'
    WHEN COALESCE(o.outreach_count, 0) < 3 THEN 'lightly_contacted'
    WHEN COALESCE(o.outreach_count, 0) < 10 THEN 'moderately_contacted'
    ELSE 'heavily_contacted'
  END as contact_status
FROM public.public_lead_pool p
LEFT JOIN (
  SELECT
    public_lead_id,
    COUNT(DISTINCT user_id) as outreach_count,
    MIN(outreached_at) as first_outreach_at,
    MAX(outreached_at) as last_outreach_at
  FROM public.lead_outreach_log
  GROUP BY public_lead_id
) o ON o.public_lead_id = p.id;

-- Function to check if current user has outreached to a lead
CREATE OR REPLACE FUNCTION has_user_outreached(p_lead_id integer, p_user_id text)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.lead_outreach_log
    WHERE public_lead_id = p_lead_id AND user_id = p_user_id
  );
END;
$$ LANGUAGE plpgsql;

-- Function to record outreach (idempotent - won't duplicate)
CREATE OR REPLACE FUNCTION record_lead_outreach(
  p_lead_id integer,
  p_user_id text,
  p_org_id uuid,
  p_channel text,
  p_campaign_id text DEFAULT NULL
) RETURNS boolean AS $$
BEGIN
  INSERT INTO public.lead_outreach_log (
    public_lead_id, user_id, organization_id, channel, campaign_id
  ) VALUES (
    p_lead_id, p_user_id, p_org_id, p_channel, p_campaign_id
  )
  ON CONFLICT (public_lead_id, user_id) DO NOTHING;

  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- Function to generate dedupe hash
CREATE OR REPLACE FUNCTION generate_lead_dedupe_hash(
  p_address text,
  p_zip text,
  p_owner text
) RETURNS text AS $$
BEGIN
  RETURN md5(
    LOWER(COALESCE(TRIM(p_address), '')) || '|' ||
    COALESCE(TRIM(p_zip), '') || '|' ||
    LOWER(COALESCE(TRIM(p_owner), ''))
  );
END;
$$ LANGUAGE plpgsql;

COMMIT;
