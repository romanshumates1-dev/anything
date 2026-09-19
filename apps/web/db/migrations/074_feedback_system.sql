-- 074_feedback_system.sql
-- User feedback system: collects feedback, feature requests, and displays a public roadmap.
-- Inspired by Canny-style feedback tools with voting, status tracking, and admin management.
-- Idempotent. Rollback: DROP TABLE feedback_responses; DROP TABLE feedback_votes; DROP TABLE feedback;

-- Feedback categories
-- BUG: Bug reports
-- FEATURE: Feature requests
-- GENERAL: General feedback
-- PRAISE: Positive feedback/testimonials

-- Feedback status progression
-- SUBMITTED: Initial state
-- UNDER_REVIEW: Being evaluated
-- PLANNED: Scheduled for implementation
-- IN_PROGRESS: Currently being worked on
-- COMPLETED: Done
-- DECLINED: Won't implement

-- Main feedback table
CREATE TABLE IF NOT EXISTS public.feedback (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id text REFERENCES public."user"(id) ON DELETE SET NULL,
  organization_id text,

  -- Content
  category text NOT NULL DEFAULT 'GENERAL'
    CHECK (category IN ('BUG', 'FEATURE', 'GENERAL', 'PRAISE')),
  title text NOT NULL,
  description text NOT NULL,

  -- Optional screenshot/attachment URL
  screenshot_url text,

  -- Priority set by user (LOW, MEDIUM, HIGH, URGENT)
  priority text NOT NULL DEFAULT 'MEDIUM'
    CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),

  -- Visibility and anonymity
  is_public boolean NOT NULL DEFAULT true,
  is_anonymous boolean NOT NULL DEFAULT false,

  -- Status tracking (admin-managed)
  status text NOT NULL DEFAULT 'SUBMITTED'
    CHECK (status IN ('SUBMITTED', 'UNDER_REVIEW', 'PLANNED', 'IN_PROGRESS', 'COMPLETED', 'DECLINED')),

  -- Voting
  vote_count integer NOT NULL DEFAULT 0,

  -- Admin notes (internal only)
  admin_notes text,

  -- Duplicate tracking
  duplicate_of_id text REFERENCES public.feedback(id) ON DELETE SET NULL,

  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  status_changed_at timestamptz,
  completed_at timestamptz
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON public.feedback (user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_org_id ON public.feedback (organization_id);
CREATE INDEX IF NOT EXISTS idx_feedback_category ON public.feedback (category);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON public.feedback (status);
CREATE INDEX IF NOT EXISTS idx_feedback_is_public ON public.feedback (is_public) WHERE is_public = true;
CREATE INDEX IF NOT EXISTS idx_feedback_vote_count ON public.feedback (vote_count DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON public.feedback (created_at DESC);

-- Votes table (one vote per user per feedback item)
CREATE TABLE IF NOT EXISTS public.feedback_votes (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  feedback_id text NOT NULL REFERENCES public.feedback(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Ensure one vote per user per feedback
  UNIQUE (feedback_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_feedback_votes_feedback_id ON public.feedback_votes (feedback_id);
CREATE INDEX IF NOT EXISTS idx_feedback_votes_user_id ON public.feedback_votes (user_id);

-- Admin responses table
CREATE TABLE IF NOT EXISTS public.feedback_responses (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  feedback_id text NOT NULL REFERENCES public.feedback(id) ON DELETE CASCADE,
  admin_id text NOT NULL REFERENCES public."user"(id) ON DELETE SET NULL,

  -- Response content
  response text NOT NULL,
  is_public boolean NOT NULL DEFAULT true,

  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_responses_feedback_id ON public.feedback_responses (feedback_id);
CREATE INDEX IF NOT EXISTS idx_feedback_responses_admin_id ON public.feedback_responses (admin_id);

-- Comments
COMMENT ON TABLE public.feedback IS
  'User feedback submissions including bug reports, feature requests, and general feedback. Supports voting and status tracking.';

COMMENT ON TABLE public.feedback_votes IS
  'Votes on feedback items. Each user can vote once per feedback item.';

COMMENT ON TABLE public.feedback_responses IS
  'Admin responses to feedback items. Can be public or internal.';

COMMENT ON COLUMN public.feedback.is_public IS
  'If true, feedback appears on public roadmap/feedback page. If false, only visible to submitter and admins.';

COMMENT ON COLUMN public.feedback.is_anonymous IS
  'If true, user identity is hidden on public views (but still tracked internally).';

COMMENT ON COLUMN public.feedback.duplicate_of_id IS
  'If this feedback is a duplicate, references the original. Votes are merged.';
