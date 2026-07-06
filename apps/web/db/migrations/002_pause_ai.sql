-- ============================================================================
-- pause-AI — per-lead flag to suppress automatic AI replies to inbound SMS.
-- Verification sprint 2026-07: the inbox UI shipped a pause/play toggle and an
-- ai_paused state, but there was no backing column, no toggle route, and the
-- inbound handler enqueued no AI job to suppress. This adds the column.
-- ============================================================================
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS ai_paused boolean NOT NULL DEFAULT false;
