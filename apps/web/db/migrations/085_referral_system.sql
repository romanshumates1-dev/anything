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
CREATE INDEX IF NOT EXISTS idx_referral_signups_month ON referral_signups(referrer_user_id, DATE_TRUNC('month', signed_up_at));

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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, platform, DATE(created_at))
);

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
