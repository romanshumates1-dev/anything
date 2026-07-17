-- 015_profile_fee_economics.sql
-- Phase V: per-profile fee economics (floor / target / stretch) driving the
-- two-sided seller+buyer ranges + the 7-14-day assignability guarantee.
-- Realistic wholesale defaults: $3k floor / $10k target / $30k stretch.
-- Luxury keeps its own larger bands. Idempotent.

ALTER TABLE public.negotiation_profiles
  ADD COLUMN IF NOT EXISTS fee_floor   numeric NOT NULL DEFAULT 3000,
  ADD COLUMN IF NOT EXISTS fee_target  numeric NOT NULL DEFAULT 10000,
  ADD COLUMN IF NOT EXISTS fee_stretch numeric NOT NULL DEFAULT 30000;

-- Optional state-level calibration lives on the campaign/list.
ALTER TABLE public.outreach_campaigns
  ADD COLUMN IF NOT EXISTS market_multiplier numeric NOT NULL DEFAULT 1;

-- Seed the reference profiles' bands (only touch the three seeds; leave any
-- owner-created profiles on the column defaults).
UPDATE public.negotiation_profiles SET fee_floor = 3000,  fee_target = 10000,  fee_stretch = 30000  WHERE id = 'standard_distressed';
UPDATE public.negotiation_profiles SET fee_floor = 5000,  fee_target = 25000,  fee_stretch = 40000  WHERE id = 'premium_midmarket';
UPDATE public.negotiation_profiles SET fee_floor = 50000, fee_target = 100000, fee_stretch = 200000 WHERE id = 'luxury_referral';

COMMENT ON COLUMN public.negotiation_profiles.fee_floor IS
  'Absolute minimum acceptable assignment profit. Assignability requires contract + fee_floor <= buyer_max.';
