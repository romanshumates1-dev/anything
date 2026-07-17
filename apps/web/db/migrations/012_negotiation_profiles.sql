-- 012_negotiation_profiles.sql
-- Phase N: per-list negotiation pricing & posture profiles.
-- Profiles change (a) the min/max the system SUGGESTS to the OWNER and (b) the
-- AI's non-numeric conversational posture. The AI still never sends a number;
-- requires_human stays true for price talk under EVERY profile. Idempotent.

CREATE TABLE IF NOT EXISTS public.negotiation_profiles (
  id                    text PRIMARY KEY,
  name                  text NOT NULL,
  segment               text,
  active                boolean NOT NULL DEFAULT true,
  arv_multiplier        numeric NOT NULL,
  repair_light_psf      numeric NOT NULL DEFAULT 0,
  repair_moderate_psf   numeric NOT NULL DEFAULT 0,
  repair_heavy_psf      numeric NOT NULL DEFAULT 0,
  big_ticket_adders     jsonb   NOT NULL DEFAULT '{}'::jsonb,
  min_fee               numeric NOT NULL,
  fee_target_max        numeric NOT NULL,
  opener_pct_of_max     numeric NOT NULL,
  tone                  text    NOT NULL DEFAULT 'direct-respectful',
  cadence_overrides     jsonb   NOT NULL DEFAULT '{}'::jsonb,
  allows_cold_outbound  boolean NOT NULL DEFAULT true,
  requires_manual_comps boolean NOT NULL DEFAULT false,
  double_close_advisory boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT negprof_tone_chk CHECK (tone IN ('direct-respectful','consultative','white-glove')),
  CONSTRAINT negprof_mult_chk CHECK (arv_multiplier > 0 AND arv_multiplier <= 1),
  CONSTRAINT negprof_opener_chk CHECK (opener_pct_of_max > 0 AND opener_pct_of_max <= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS negprof_name_idx ON public.negotiation_profiles (name);

-- Campaigns/lists carry a profile; per-lead override is allowed downstream.
ALTER TABLE public.outreach_campaigns
  ADD COLUMN IF NOT EXISTS negotiation_profile_id text REFERENCES public.negotiation_profiles(id);

-- Seed the three reference profiles (exact params from the spec). Editable in UI.
INSERT INTO public.negotiation_profiles
  (id, name, segment, arv_multiplier, repair_light_psf, repair_moderate_psf, repair_heavy_psf,
   big_ticket_adders, min_fee, fee_target_max, opener_pct_of_max, tone, cadence_overrides,
   allows_cold_outbound, requires_manual_comps, double_close_advisory)
VALUES
  ('standard_distressed', 'Standard Distressed', 'free-list optimized',
   0.70, 20, 38, 60, '{"roof20yr":12500,"hvac_dead":7000,"foundation":"ESCALATE"}'::jsonb,
   10000, 15000, 0.82, 'direct-respectful', '{}'::jsonb, true, false, false),
  ('premium_midmarket', 'Premium Mid-Market', '$350k-700k',
   0.73, 22, 40, 65, '{"roof20yr":12500,"hvac_dead":7000,"foundation":"ESCALATE"}'::jsonb,
   15000, 40000, 0.85, 'consultative', '{"dropDay3Voice":true,"stretchDay7ToDay10":true}'::jsonb,
   true, false, false),
  ('luxury_referral', 'Luxury Referral', '$1M+',
   0.82, 0, 0, 0, '{"foundation":"ESCALATE"}'::jsonb,
   50000, 200000, 0.88, 'white-glove', '{}'::jsonb, false, true, true)
ON CONFLICT (name) DO NOTHING;

COMMENT ON TABLE public.negotiation_profiles IS
  'Phase N per-list pricing/posture. Owner-only suggestions; AI never emits a number. allows_cold_outbound=false (luxury) is read by dispatchGate to SKIP cold sends.';
