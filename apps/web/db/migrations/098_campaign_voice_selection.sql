-- Migration 098 — REQUIREMENT SET T: AI voice selection (roman.agent.md 1199-1216).
--
--   For campaigns using calling:
--     Voice selection options:
--       * Auto
--       * Manually selected voice
--     When Auto is selected:
--       Use a deterministic recommendation system based on available campaign
--       context. The recommendation must be explainable enough to debug.
--       Do not randomly change a user's selected voice.
--
-- WHAT THIS ADDS
-- --------------
-- Four columns on campaign_settings:
--
--   voice_selection_mode  'auto' | 'manual'. Defaults to 'auto', so every
--                         existing campaign keeps a defined behaviour instead
--                         of a NULL that each reader has to interpret.
--   voice_id              the provider voice currently in effect for the
--                         campaign (e.g. 'twilio.jane'), or NULL when calling
--                         is not one of the campaign's channels.
--   voice_resolved_from   the context fingerprint the current voice_id was
--                         derived from. Lets an operator (and the API) tell a
--                         voice that is still valid for the campaign as it
--                         stands today from a stale one.
--   voice_resolved_at     when that resolution happened.
--
-- WHY A NEW FILE AND NOT AN EDIT TO 079
-- ------------------------------------
-- 079 has already been applied to production. Editing an applied migration is
-- the classic way for a schema change to exist in the repo and never reach the
-- live database, because the migration runner skips files it has already seen.
--
-- WHY THE CHECK CONSTRAINT
-- -----------------------
-- The mode is read by the recommender to decide whether it is allowed to
-- change voice_id at all. A typo such as 'AUTO' or 'Manually' would otherwise
-- fall through to the manual branch and permanently freeze a voice that the
-- operator believes is automatic. The constraint turns that silent freeze into
-- a write-time error.
--
-- Idempotent. Rollback:
--   ALTER TABLE public.campaign_settings DROP CONSTRAINT campaign_settings_voice_selection_mode_chk;
--   ALTER TABLE public.campaign_settings
--     DROP COLUMN IF EXISTS voice_selection_mode,
--     DROP COLUMN IF EXISTS voice_id,
--     DROP COLUMN IF EXISTS voice_resolved_from,
--     DROP COLUMN IF EXISTS voice_resolved_at;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'campaign_settings'
      AND column_name = 'voice_selection_mode'
  ) THEN
    ALTER TABLE public.campaign_settings
      ADD COLUMN voice_selection_mode text NOT NULL DEFAULT 'auto';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'campaign_settings'
      AND column_name = 'voice_id'
  ) THEN
    ALTER TABLE public.campaign_settings ADD COLUMN voice_id text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'campaign_settings'
      AND column_name = 'voice_resolved_from'
  ) THEN
    ALTER TABLE public.campaign_settings ADD COLUMN voice_resolved_from text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'campaign_settings'
      AND column_name = 'voice_resolved_at'
  ) THEN
    ALTER TABLE public.campaign_settings ADD COLUMN voice_resolved_at timestamptz;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaign_settings_voice_selection_mode_chk'
  ) THEN
    ALTER TABLE public.campaign_settings
      ADD CONSTRAINT campaign_settings_voice_selection_mode_chk
      CHECK (voice_selection_mode IN ('auto', 'manual'));
  END IF;
END $$;

COMMENT ON COLUMN public.campaign_settings.voice_selection_mode IS
  'Set T: auto = deterministic recommendation; manual = operator choice, never auto-rewritten';
COMMENT ON COLUMN public.campaign_settings.voice_id IS
  'Set T: resolved provider voice id in effect for this campaign';
COMMENT ON COLUMN public.campaign_settings.voice_resolved_from IS
  'Set T: context fingerprint the current voice_id was derived from';