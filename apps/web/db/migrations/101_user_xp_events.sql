-- Migration 101 — general XP event ledger
--
-- WHY
-- ---
-- `awardXp()` is the general account-level XP credit path. It accepts an
-- optional `eventKey` for idempotency, and the server logic relies on a unique
-- ledger row so a replay or concurrent duplicate request cannot credit the same
-- logical event twice.
--
-- This table was missing from the runtime schema even though the server logic
-- and tests were written to depend on it. Adding it here makes the shipped
-- migration set match the actual API contract and preserves the exact-once
-- guarantee at the database layer.

CREATE TABLE IF NOT EXISTS public.user_xp_events (
  id serial PRIMARY KEY,
  user_id text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  xp integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, event_key),
  CONSTRAINT user_xp_events_xp_positive CHECK (xp > 0)
);

CREATE INDEX IF NOT EXISTS idx_user_xp_events_user
  ON public.user_xp_events(user_id, created_at DESC);

COMMENT ON TABLE public.user_xp_events IS
  'Idempotency ledger for general account XP awards. UNIQUE(user_id, event_key) '
  'prevents replayed or concurrent duplicate awards from crediting the same '
  'logical event twice.';
