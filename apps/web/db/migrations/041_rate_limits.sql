-- Migration 041 — durable rate_limits table.
-- The public contact/review rate limiter (utils/rateLimit.ts) previously
-- tracked counts in an in-memory Map, and a dead rateLimitDb() helper
-- referenced this exact table without a migration ever creating it
-- (docs/AUDIT_2026-07-21.md, FINAL_STATE.md "durable rate limiting NOT DONE").
-- An in-memory Map resets on every process restart and provides ~zero
-- protection on serverless (Vercel invokes across many short-lived
-- isolates with no shared memory) — this table replaces it.
--
-- Fixed-window design: (identifier, action, window_start) is the primary
-- key, so a concurrent burst of requests serializes on the row's unique
-- constraint via INSERT ... ON CONFLICT DO UPDATE — no read-then-write race.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.rate_limits (
  identifier    text        NOT NULL,
  action        text        NOT NULL,
  window_start  timestamptz NOT NULL,
  count         integer     NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (identifier, action, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_window_start
  ON public.rate_limits (window_start);
