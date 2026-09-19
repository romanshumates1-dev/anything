-- ============================================================================
-- Migration 076 - User Questionnaire for CRM/Audience Targeting
--
-- Purpose: Gather data to understand user segments for better advertising
-- targeting and conversion optimization. This is an optional, skippable
-- questionnaire shown after signup.
-- ============================================================================

-- User questionnaire responses table
CREATE TABLE IF NOT EXISTS public.user_questionnaire_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,

  -- Experience & Scale (Screen 1)
  experience_level text CHECK (experience_level IN ('BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT')),
  deals_per_month text CHECK (deals_per_month IN ('0', '1-2', '3-5', '6-10', '10+')),
  team_size text CHECK (team_size IN ('solo', '2-5', '6-10', '10+')),

  -- Current Situation (Screen 2)
  primary_market text CHECK (primary_market IN ('residential', 'commercial', 'land', 'mixed')),
  current_tools text[], -- Array of tools they currently use
  biggest_challenge text CHECK (biggest_challenge IN ('lead_gen', 'follow_up', 'closing', 'scaling', 'other')),

  -- Goals & Discovery (Screen 3)
  how_heard_about_us text CHECK (how_heard_about_us IN ('google', 'social', 'referral', 'podcast', 'youtube', 'other')),
  budget_range text CHECK (budget_range IN ('bootstrap', '50-200', '200-500', '500+')),
  goals text, -- Free-form text for what they want to achieve

  -- Metadata
  completed_at timestamptz, -- NULL if started but not completed
  skipped_at timestamptz,   -- NULL if not skipped
  reminder_dismissed_at timestamptz, -- NULL if dashboard reminder not dismissed
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Ensure one response per user
  CONSTRAINT unique_user_questionnaire UNIQUE (user_id)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_questionnaire_user_id ON public.user_questionnaire_responses(user_id);
CREATE INDEX IF NOT EXISTS idx_questionnaire_completed ON public.user_questionnaire_responses(completed_at) WHERE completed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_questionnaire_created ON public.user_questionnaire_responses(created_at);

-- Index for analytics queries
CREATE INDEX IF NOT EXISTS idx_questionnaire_experience ON public.user_questionnaire_responses(experience_level) WHERE experience_level IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_questionnaire_challenge ON public.user_questionnaire_responses(biggest_challenge) WHERE biggest_challenge IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_questionnaire_source ON public.user_questionnaire_responses(how_heard_about_us) WHERE how_heard_about_us IS NOT NULL;

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_questionnaire_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS questionnaire_updated_at ON public.user_questionnaire_responses;
CREATE TRIGGER questionnaire_updated_at
  BEFORE UPDATE ON public.user_questionnaire_responses
  FOR EACH ROW
  EXECUTE FUNCTION update_questionnaire_updated_at();

-- Add questionnaire tracking column to user table if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user' AND column_name = 'questionnaire_completed'
  ) THEN
    ALTER TABLE "user" ADD COLUMN questionnaire_completed boolean DEFAULT false;
  END IF;
END $$;
