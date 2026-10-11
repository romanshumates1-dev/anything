-- Migration 100 — season XP event ledger.
--
-- WHY
-- ---
-- Migration 099 created `user_season_progress(user_id, season_id, xp)` with
-- UNIQUE(user_id, season_id), and nothing in the app ever wrote it. Writing it
-- naively is a read-then-write:
--
--     SELECT xp FROM user_season_progress WHERE user_id = $1 AND season_id = $2
--     UPDATE user_season_progress SET xp = <old + n> WHERE ...
--
-- Two concurrent requests read the same old total and one award is lost — and
-- because the caller was already told "awarded", the user sees XP disappear.
--
-- The atomic fix is `INSERT ... ON CONFLICT (user_id, season_id) DO UPDATE
-- SET xp = xp + n`, which lets the database serialise the arithmetic. But
-- "award XP once for finishing the onboarding quest" is an EVENT, and a bare
-- accumulator has no natural key: a retried request, a double-click, or two
-- open tabs all look identical to the second credit, so the quest pays out
-- every time it is replayed.
--
-- WHAT THIS DOES
-- --------------
-- Adds `user_season_xp_events`, the natural key for "this user has already been
-- paid for this exact event in this season". The credit path then becomes
-- insert-the-event-then-accumulate: the event insert either creates the row (and
-- the credit proceeds) or conflicts (and the credit is skipped). The database
-- picks the winner of any concurrent race, so N replays credit exactly once.
--
-- WHY A SEPARATE TABLE INSTEAD OF A REASON COLUMN ON THE PROGRESS ROW
-- -------------------------------------------------------------------
-- A user accumulates many distinct reasons per season — quest completion, a
-- listing created, a referral — and each must be independently idempotent. One
-- `reason` column on `user_season_progress` could only remember the last one.
-- A ledger row per reason keeps them all, which also makes a leaderboard
-- auditable: every XP point traces to the event that granted it.
--
-- XP ONLY. This table and the path that writes it touch no credit balance, no
-- withdrawal, and no payout. A bug here can make a season leaderboard wrong; it
-- cannot make a wallet wrong.
--
-- IF EXISTING DATA VIOLATES THIS the migration fails loudly. `user_season_progress`
-- already exists and holds rows whose XP cannot be decomposed back into reasons
-- after the fact, so backfilling event rows for them would be inventing history.
-- They keep their XP as a balance with no ledger entry, which the credit path
-- handles by accumulating from wherever the balance already sits.

CREATE TABLE IF NOT EXISTS public.user_season_xp_events (
  id serial PRIMARY KEY,
  user_id text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  season_id integer NOT NULL REFERENCES public.gamification_seasons(id) ON DELETE CASCADE,
  -- Operator/caller-chosen idempotency key. Stable per genuine event.
  reason text NOT NULL,
  xp integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- The natural key. This single constraint is what makes a replay a no-op:
  -- the second INSERT of the same (user, season, reason) conflicts here.
  UNIQUE(user_id, season_id, reason),
  CONSTRAINT user_season_xp_events_xp_positive CHECK (xp > 0)
);

-- Lookup by user history and by season audit.
CREATE INDEX IF NOT EXISTS idx_user_season_xp_events_user
  ON public.user_season_xp_events(user_id, season_id, created_at DESC);

COMMENT ON TABLE public.user_season_xp_events IS
  'Idempotency ledger for season XP credits. UNIQUE(user_id, season_id, reason) '
  'makes a replayed award a no-op. XP only — never credits or cash.';
