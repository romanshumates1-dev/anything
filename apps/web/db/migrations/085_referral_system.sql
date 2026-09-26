-- ============================================================================
-- Referral/Affiliate Credit Reward System
-- Tracks user referral codes, signups, social shares, and monthly bonuses
-- ============================================================================

-- Referral codes and tracking
CREATE TABLE IF NOT EXISTS user_referral_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_referral_codes_code ON user_referral_codes(code);
CREATE INDEX IF NOT EXISTS idx_user_referral_codes_user ON user_referral_codes(user_id);

-- Track referrals
CREATE TABLE IF NOT EXISTS referral_signups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id TEXT NOT NULL REFERENCES "user"(id),
  referred_user_id TEXT NOT NULL REFERENCES "user"(id),
  referral_code TEXT NOT NULL,
  signed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_purchase_at TIMESTAMPTZ,
  credits_awarded BOOLEAN DEFAULT FALSE,
  credits_awarded_at TIMESTAMPTZ,
  credits_amount INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_referral_signups_referrer ON referral_signups(referrer_user_id);
CREATE INDEX IF NOT EXISTS idx_referral_signups_referred ON referral_signups(referred_user_id);
-- The original expression was
--   (referrer_user_id, DATE_TRUNC('month', signed_up_at))
-- which Postgres rejects: expression indexes require IMMUTABLE functions and
-- date_trunc() is only STABLE, so CREATE INDEX failed and aborted the chain.
-- Index the raw timestamp instead. It serves the same monthly-rollup queries
-- (`WHERE referrer_user_id = ? AND signed_up_at >= ? AND signed_up_at < ?`)
-- with an index range scan, so no query needs a derived column to stay fast.
CREATE INDEX IF NOT EXISTS idx_referral_signups_month
  ON referral_signups(referrer_user_id, signed_up_at);

-- Social media shares for bonus credits
CREATE TABLE IF NOT EXISTS social_media_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('twitter', 'facebook', 'linkedin', 'instagram', 'tiktok')),
  share_url TEXT,
  verified BOOLEAN DEFAULT FALSE,
  credits_awarded BOOLEAN DEFAULT FALSE,
  credits_amount INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- The original table-level constraint was
  --   UNIQUE(user_id, platform, DATE(created_at))
  -- which Postgres rejects: a table constraint may only name columns, never an
  -- expression ("syntax error at or near ("). The intent — at most one share per
  -- user, per platform, per day — is enforced by the unique expression index
  -- below instead.
);

-- DATE(created_at) / created_at::date resolve against the session TimeZone, so
-- they are only STABLE and cannot appear in an index or constraint either.
-- Pinning the cast to UTC makes the expression IMMUTABLE while preserving the
-- intended "per day" semantics, and does so deterministically rather than
-- depending on whatever TimeZone the session happens to use.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_social_shares_user_platform_day
  ON social_media_shares (user_id, platform, ((created_at AT TIME ZONE 'UTC')::date));

CREATE INDEX IF NOT EXISTS idx_social_shares_user ON social_media_shares(user_id);
CREATE INDEX IF NOT EXISTS idx_social_shares_platform ON social_media_shares(platform);

-- Monthly bonus tracking
CREATE TABLE IF NOT EXISTS monthly_referral_bonuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  month_year TEXT NOT NULL,
  referral_count INTEGER DEFAULT 0,
  bonus_credits_awarded INTEGER DEFAULT 0,
  threshold_reached BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, month_year)
);

CREATE INDEX IF NOT EXISTS idx_monthly_bonuses_user ON monthly_referral_bonuses(user_id);
CREATE INDEX IF NOT EXISTS idx_monthly_bonuses_month ON monthly_referral_bonuses(month_year);

-- Add referral_code column to track how users signed up
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS referred_by_code TEXT;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS referred_at TIMESTAMPTZ;
