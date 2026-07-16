-- 013_negotiation_profile_versioning.sql
-- Adds versioning/rollback support for negotiation profiles.
-- Idempotent.

BEGIN;

-- Version history table: every UPDATE to negotiation_profiles creates a new row here.
CREATE TABLE IF NOT EXISTS public.negotiation_profile_versions (
  id              serial PRIMARY KEY,
  profile_id      text NOT NULL REFERENCES public.negotiation_profiles(id) ON DELETE CASCADE,
  version         integer NOT NULL,
  snapshot        jsonb NOT NULL,
  changed_by      text,
  change_reason   text,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT negprof_version_unique UNIQUE (profile_id, version)
);

-- Track current version per profile for fast lookups.
ALTER TABLE public.negotiation_profiles
  ADD COLUMN IF NOT EXISTS current_version integer NOT NULL DEFAULT 1;

-- Auto-bump version on update.
CREATE OR REPLACE FUNCTION public.bump_negotiation_profile_version()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.id IS NOT NULL THEN
    INSERT INTO public.negotiation_profile_versions
      (profile_id, version, snapshot, changed_by, change_reason)
    VALUES (
      OLD.id,
      OLD.current_version + 1,
      jsonb_build_object(
        'id', OLD.id,
        'name', OLD.name,
        'segment', OLD.segment,
        'active', OLD.active,
        'arv_multiplier', OLD.arv_multiplier,
        'repair_light_psf', OLD.repair_light_psf,
        'repair_moderate_psf', OLD.repair_moderate_psf,
        'repair_heavy_psf', OLD.repair_heavy_psf,
        'big_ticket_adders', OLD.big_ticket_adders,
        'min_fee', OLD.min_fee,
        'fee_target_max', OLD.fee_target_max,
        'opener_pct_of_max', OLD.opener_pct_of_max,
        'tone', OLD.tone,
        'cadence_overrides', OLD.cadence_overrides,
        'allows_cold_outbound', OLD.allows_cold_outbound,
        'requires_manual_comps', OLD.requires_manual_comps,
        'double_close_advisory', OLD.double_close_advisory
      ),
      current_setting('app.current_user_id', true),
      TG_ARGV[0]
    );
    NEW.current_version := OLD.current_version + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to negotiation_profiles (skip if already present).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.negotiation_profiles'::regclass
      AND tgname = 'negotiation_profiles_version_trigger'
  ) THEN
    CREATE TRIGGER negotiation_profiles_version_trigger
      BEFORE UPDATE ON public.negotiation_profiles
      FOR EACH ROW
      EXECUTE FUNCTION public.bump_negotiation_profile_version();
  END IF;
END;
$$;

-- Helper: rollback a profile to a prior version.
-- Returns the restored profile row, or NULL if version not found.
CREATE OR REPLACE FUNCTION public.rollback_negotiation_profile(
  p_profile_id text,
  p_target_version integer
) RETURNS public.negotiation_profiles AS $$
DECLARE
  v_snapshot jsonb;
  v_current integer;
  v_result public.negotiation_profiles;
BEGIN
  SELECT snapshot, profile_id
    INTO v_snapshot, v_current
    FROM public.negotiation_profile_versions
   WHERE profile_id = p_profile_id
     AND version = p_target_version;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.negotiation_profiles
     SET name = v_snapshot->>'name',
         segment = v_snapshot->>'segment',
         active = (v_snapshot->>'active')::boolean,
         arv_multiplier = (v_snapshot->>'arv_multiplier')::numeric,
         repair_light_psf = (v_snapshot->>'repair_light_psf')::numeric,
         repair_moderate_psf = (v_snapshot->>'repair_moderate_psf')::numeric,
         repair_heavy_psf = (v_snapshot->>'repair_heavy_psf')::numeric,
         big_ticket_adders = (v_snapshot->>'big_ticket_adders')::jsonb,
         min_fee = (v_snapshot->>'min_fee')::numeric,
         fee_target_max = (v_snapshot->>'fee_target_max')::numeric,
         opener_pct_of_max = (v_snapshot->>'opener_pct_of_max')::numeric,
         tone = v_snapshot->>'tone',
         cadence_overrides = (v_snapshot->>'cadence_overrides')::jsonb,
         allows_cold_outbound = (v_snapshot->>'allows_cold_outbound')::boolean,
         requires_manual_comps = (v_snapshot->>'requires_manual_comps')::boolean,
         double_close_advisory = (v_snapshot->>'double_close_advisory')::boolean
   WHERE id = p_profile_id
   RETURNING * INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE public.negotiation_profile_versions IS
  'Immutable audit trail + rollback source for negotiation profile changes.';