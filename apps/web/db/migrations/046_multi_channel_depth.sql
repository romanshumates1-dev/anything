-- 046: Multi-channel depth engine
-- Adds channel awareness to the cadence system, email warmup tracking,
-- call attempt tracking, and resurrection tables.

-- 1. Channel column on message templates (default 'sms' preserves existing behavior)
ALTER TABLE public.campaign_message_templates
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'sms';

-- Constraint added separately so existing rows are not rejected
DO $$ BEGIN
  ALTER TABLE public.campaign_message_templates
    ADD CONSTRAINT campaign_message_templates_channel_check
    CHECK (channel IN ('sms', 'email', 'call'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Email warmup: daily send/bounce/complaint counters per org
CREATE TABLE IF NOT EXISTS public.email_daily_sends (
  organization_id text NOT NULL,
  date date NOT NULL,
  sent_count integer NOT NULL DEFAULT 0,
  bounce_count integer NOT NULL DEFAULT 0,
  complaint_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, date)
);

-- 3. Email warmup config per org
CREATE TABLE IF NOT EXISTS public.email_warmup_config (
  organization_id text PRIMARY KEY,
  daily_limit integer NOT NULL DEFAULT 20,
  ramp_increment integer NOT NULL DEFAULT 10,
  ramp_interval_days integer NOT NULL DEFAULT 2,
  auto_pause_bounce_pct numeric NOT NULL DEFAULT 5.0,
  auto_pause_complaint_pct numeric NOT NULL DEFAULT 0.1,
  paused boolean NOT NULL DEFAULT false,
  paused_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 4. Call attempt tracking
CREATE TABLE IF NOT EXISTS public.call_attempts (
  id serial PRIMARY KEY,
  organization_id text NOT NULL,
  lead_id integer NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  outcome text NOT NULL,
  notes text,
  next_attempt_at timestamptz,
  attempt_number integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_call_attempts_lead ON public.call_attempts (lead_id, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_attempts_org ON public.call_attempts (organization_id, attempted_at DESC);

-- 5. Resurrection engine tables
CREATE TABLE IF NOT EXISTS public.resurrection_campaign_config (
  organization_id text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  sequences jsonb NOT NULL DEFAULT '[{"day":30,"channel":"email","template":"Just checking in — is {property_address} still something you might consider selling?"},{"day":60,"channel":"sms","template":"Hi {first_name}, we reached out about {property_address} a while back. Still have any interest in a cash offer?"},{"day":90,"channel":"email","template":"Following up on {property_address}. Our offer still stands if timing works better now."},{"day":180,"channel":"sms","template":"Hi {first_name}, last check-in on {property_address}. If you ever want a no-obligation cash offer, just reply here."}]',
  target_statuses text[] NOT NULL DEFAULT '{"COLD","DEAL_NO_AGREEMENT"}',
  monthly_max integer NOT NULL DEFAULT 10000,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.resurrection_sent_log (
  id serial PRIMARY KEY,
  organization_id text NOT NULL,
  lead_id integer NOT NULL,
  sequence_day integer NOT NULL,
  channel text NOT NULL DEFAULT 'sms',
  message_template text NOT NULL,
  message_id text,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'bounced', 'skipped')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, lead_id, sequence_day)
);
CREATE INDEX IF NOT EXISTS idx_resurrection_org_day ON public.resurrection_sent_log (organization_id, sequence_day);

-- 6. Attribution indexes for inbound source tracking
CREATE INDEX IF NOT EXISTS idx_leads_source ON public.leads (source) WHERE source IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_compliance_records_source
  ON public.compliance_records ((metadata->>'source')) WHERE metadata->>'source' IS NOT NULL;
