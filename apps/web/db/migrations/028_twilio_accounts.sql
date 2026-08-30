-- ============================================================================
-- Twilio accounts - customer-managed Twilio credentials
-- Each organization can optionally connect their own Twilio account
-- Credentials are encrypted at rest using the platform secret
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.twilio_accounts (
  id text PRIMARY KEY DEFAULT 'twilio_' || gen_random_uuid()::text,
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_sid_encrypted text,
  auth_token_encrypted text,
  messaging_service_sid text,
  phone_number text,
  campaign_sid text,
  campaign_status text DEFAULT 'pending' CHECK (campaign_status IN ('pending', 'approved', 'rejected')),
  monthly_sms_quota integer NOT NULL DEFAULT 1000,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_twilio_accounts_org ON public.twilio_accounts (organization_id);
CREATE INDEX IF NOT EXISTS idx_twilio_accounts_campaign ON public.twilio_accounts (campaign_sid);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_twilio_accounts_org ON public.twilio_accounts (organization_id);