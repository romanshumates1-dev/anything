-- Migration 038 — user-level ban / suspend state.
--
-- The prior admin/bans route targeted a `bans` table that exists in NO
-- migration (BREAKAGE_TABLE #29) and was org-level; the Prompt-1-Phase-4 spec
-- is USER-level: ban (permanent, revokes sessions, rejects login + API token),
-- suspend (temporary lock). Ban/suspend state lives on the user so every auth
-- layer (better-auth session hook, middleware access gate, v1 key owner check)
-- can enforce it from the single source with one column read.
-- ============================================================================

ALTER TABLE public."user" ADD COLUMN IF NOT EXISTS banned boolean NOT NULL DEFAULT false;
ALTER TABLE public."user" ADD COLUMN IF NOT EXISTS ban_reason text;
ALTER TABLE public."user" ADD COLUMN IF NOT EXISTS banned_at timestamptz;
ALTER TABLE public."user" ADD COLUMN IF NOT EXISTS banned_by text;
-- suspended_until in the future = temporarily locked; NULL/past = not suspended.
ALTER TABLE public."user" ADD COLUMN IF NOT EXISTS suspended_until timestamptz;

CREATE INDEX IF NOT EXISTS idx_user_banned ON public."user" (banned) WHERE banned = true;
