-- ============================================================================
-- Outreach Verification System
-- Self-service verification for user-provided SMS/Email credentials
-- ============================================================================

-- Verification status tracking for each channel
CREATE TABLE IF NOT EXISTS outreach_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'email')),
  provider TEXT NOT NULL CHECK (provider IN ('platform', 'twilio', 'aws_sns', 'aws_ses', 'smtp', 'sendgrid', 'resend')),

  -- Status flow: PENDING -> VERIFYING -> VERIFIED -> ACTIVE | FAILED | SUSPENDED
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING',      -- Initial state, credentials entered but not verified
    'VERIFYING',    -- Verification in progress (code sent or DNS check pending)
    'DNS_PENDING',  -- Email: waiting for DNS propagation
    'VERIFIED',     -- Ownership verified, awaiting compliance acknowledgment
    'ACTIVE',       -- Ready to use
    'FAILED',       -- Verification failed
    'SUSPENDED',    -- Admin suspended (abuse, non-payment, etc.)
    'EXPIRED'       -- Verification expired, needs re-verification
  )),

  -- Verification details
  verification_code TEXT,                    -- OTP code for SMS verification
  verification_code_expires_at TIMESTAMPTZ,  -- Code expiration (15 minutes)
  verification_attempts INTEGER DEFAULT 0,   -- Failed code entry attempts
  verified_at TIMESTAMPTZ,                   -- When ownership was verified

  -- Encrypted credentials (AES-256-GCM via app-level encryption)
  credentials_encrypted TEXT,

  -- Channel-specific metadata
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- SMS: { phone_number, tcpa_agreed, tcpa_agreed_at, messaging_service_sid }
  -- Email: { domain, from_address, from_name, spf_verified, dkim_verified, dmarc_verified, dns_records }

  -- Compliance acknowledgments
  compliance_agreed BOOLEAN DEFAULT FALSE,
  compliance_agreed_at TIMESTAMPTZ,
  compliance_agreed_by TEXT,  -- user_id who agreed

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_verified_at TIMESTAMPTZ,  -- For periodic re-verification
  suspended_at TIMESTAMPTZ,
  suspended_reason TEXT,

  -- Unique constraint: one verification per org per channel
  CONSTRAINT outreach_verifications_org_channel_unique UNIQUE (organization_id, channel)
);

-- Index for status queries
CREATE INDEX IF NOT EXISTS idx_outreach_verifications_status
  ON outreach_verifications(status);

-- Index for organization lookups
CREATE INDEX IF NOT EXISTS idx_outreach_verifications_org
  ON outreach_verifications(organization_id);

-- Audit log for verification events
CREATE TABLE IF NOT EXISTS outreach_verification_logs (
  id SERIAL PRIMARY KEY,
  verification_id UUID NOT NULL REFERENCES outreach_verifications(id) ON DELETE CASCADE,
  event TEXT NOT NULL,  -- 'created', 'code_sent', 'code_verified', 'dns_check', 'activated', 'suspended', etc.
  old_status TEXT,
  new_status TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  performed_by TEXT,  -- user_id
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outreach_verification_logs_verification
  ON outreach_verification_logs(verification_id);

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_outreach_verification_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update timestamp
DROP TRIGGER IF EXISTS outreach_verifications_updated_at ON outreach_verifications;
CREATE TRIGGER outreach_verifications_updated_at
  BEFORE UPDATE ON outreach_verifications
  FOR EACH ROW
  EXECUTE FUNCTION update_outreach_verification_timestamp();

-- Helper function to check if outreach is active for an organization
CREATE OR REPLACE FUNCTION is_outreach_active(
  p_organization_id TEXT,
  p_channel TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_status TEXT;
  v_provider TEXT;
BEGIN
  SELECT status, provider INTO v_status, v_provider
  FROM outreach_verifications
  WHERE organization_id = p_organization_id AND channel = p_channel;

  -- If no record exists, check if they're using platform provider (always active)
  IF v_status IS NULL THEN
    -- Check app_settings for platform provider
    -- Platform providers don't need verification
    RETURN FALSE;
  END IF;

  -- Platform providers are always considered active
  IF v_provider = 'platform' THEN
    RETURN TRUE;
  END IF;

  RETURN v_status = 'ACTIVE';
END;
$$ LANGUAGE plpgsql;

-- Comment explaining the system
COMMENT ON TABLE outreach_verifications IS
'Tracks verification status for user-provided SMS/Email credentials.
Platform providers (our infrastructure) skip verification.
BYOP (Twilio, AWS, SMTP) requires ownership verification to prevent credential theft.';

COMMENT ON COLUMN outreach_verifications.credentials_encrypted IS
'AES-256-GCM encrypted credentials JSON. Decryption happens at application level.';

COMMENT ON COLUMN outreach_verifications.metadata IS
'Channel-specific data: phone_number for SMS, domain/dns_records for email.';
