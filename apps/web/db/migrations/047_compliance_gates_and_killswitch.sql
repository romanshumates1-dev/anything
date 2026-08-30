-- 047: Compliance gate registry + kill-switch + JV/referral schema
-- Phase 0A: fail-closed compliance gates per jurisdiction×channel
-- Phase 8/9: JV intake and referral origination tracking

-- ── COMPLIANCE GATE REGISTRY ──────────────────────────────────────────────
-- Every jurisdiction×channel combo defaults FALSE (fail-closed).
-- The dispatch path checks this before any cold send fires.
CREATE TABLE IF NOT EXISTS public.compliance_gates (
  id serial PRIMARY KEY,
  organization_id text NOT NULL,
  jurisdiction text NOT NULL,        -- e.g. 'KY', 'KY-Jefferson', 'TN-Davidson'
  channel text NOT NULL,             -- 'sms' | 'email' | 'mail' | 'voice' | 'rvm'
  attorney_reviewed boolean NOT NULL DEFAULT false,
  reviewed_date date,
  reviewed_by text,
  source_terms_confirmed boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, jurisdiction, channel)
);
CREATE INDEX IF NOT EXISTS idx_compliance_gates_org ON public.compliance_gates (organization_id, jurisdiction, channel);

-- ── KILL-SWITCH ───────────────────────────────────────────────────────────
-- One row per org. active=true means ALL outbound is halted immediately.
CREATE TABLE IF NOT EXISTS public.outbound_kill_switch (
  organization_id text PRIMARY KEY,
  active boolean NOT NULL DEFAULT false,
  reason text,
  activated_by text,
  activated_at timestamptz,
  deactivated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── JV / REFERRAL ORIGINATION ─────────────────────────────────────────────
-- origination_type on deals/contracts: OWN_ORIGINATED | JV_INTAKE | REFERRAL_OUT
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS origination_type text NOT NULL DEFAULT 'OWN_ORIGINATED'
    CHECK (origination_type IN ('OWN_ORIGINATED', 'JV_INTAKE', 'REFERRAL_OUT'));

CREATE TABLE IF NOT EXISTS public.jv_deals (
  id serial PRIMARY KEY,
  organization_id text NOT NULL,
  contract_id text REFERENCES public.contracts(id),
  originating_wholesaler_name text NOT NULL,
  originating_wholesaler_contact text,
  fee_split_pct numeric NOT NULL DEFAULT 50 CHECK (fee_split_pct > 0 AND fee_split_pct <= 100),
  contract_price_cents integer,
  closing_deadline date,
  expiration_deadline date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'expired', 'cancelled')),
  payout_cents integer,
  payout_recorded_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jv_deals_org ON public.jv_deals (organization_id, status);

-- ── REFERRAL PARTNERS ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.referral_partners (
  id serial PRIMARY KEY,
  organization_id text NOT NULL,
  name text NOT NULL,
  contact text,
  service_areas text[] NOT NULL DEFAULT '{}',
  referral_fee_pct numeric NOT NULL DEFAULT 25 CHECK (referral_fee_pct >= 0 AND referral_fee_pct <= 100),
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referral_partners_org ON public.referral_partners (organization_id, active);

CREATE TABLE IF NOT EXISTS public.referral_handoffs (
  id serial PRIMARY KEY,
  organization_id text NOT NULL,
  lead_id integer,
  partner_id integer REFERENCES public.referral_partners(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'closed', 'fee_received')),
  fee_received_cents integer,
  closed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referral_handoffs_org ON public.referral_handoffs (organization_id, status);

-- ── BUYER NETWORK ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.buyers (
  id serial PRIMARY KEY,
  organization_id text NOT NULL,
  name text NOT NULL,
  phone text,
  email text,
  zip_codes text[] NOT NULL DEFAULT '{}',
  price_min_cents integer,
  price_max_cents integer,
  cash_buyer boolean NOT NULL DEFAULT true,
  property_types text[] NOT NULL DEFAULT '{}',
  quality_score integer NOT NULL DEFAULT 0 CHECK (quality_score >= 0 AND quality_score <= 100),
  verified boolean NOT NULL DEFAULT false,
  responsiveness_score integer NOT NULL DEFAULT 50,
  actual_close_count integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'manual',  -- 'cash_deed' | 'repeat_grantee' | 'manual'
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_buyers_org_zip ON public.buyers USING GIN (zip_codes) WHERE TRUE;
CREATE INDEX IF NOT EXISTS idx_buyers_org ON public.buyers (organization_id, quality_score DESC);
