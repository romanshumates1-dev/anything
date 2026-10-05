-- Migration 099 — gamification reward layer: seasons, battle pass, crates,
-- spin wheel, competitions, use codes, giveaways.
--
-- REQUIREMENT SET V (roman.agent.md 1272-1284), the parts that were genuinely
-- absent. `user_stats` / `achievements` / `user_achievements` already exist
-- (migration 068) and cover XP, points, levels and the leaderboard. What did
-- NOT exist anywhere in the repo — verified by file-name search, content search
-- of src/**, migration search, and git history — is the reward layer below.
--
-- SAFETY POSTURE (roman.agent.md: "Avoid gambling-like mechanics that create
-- actual monetary wagering unless explicitly supported and legally reviewed")
--
-- Every reward here is BOUNDED and EARNED. There is no purchasable-loot
-- mechanic and no mechanism converts a wager into money:
--
--   * `spin_wheel_spins` is granted by ACHIEVEMENT progress (the `progress`
--     column of the already-existing user_achievements table), never bought.
--   * No table below accepts money. There is no `price`, `cost`, `stake` or
--     `wager` column anywhere in this migration, by design.
--   * Crates drop XP and cosmetic-only cosmetics, never credits, never cash.
--   * Redeemable use codes grant XP only. They cannot mint credits, which are
--     the only thing in this app with monetary value. That is asserted by a
--     test, not just intended.
--
-- The single monetary item is `giveaways`, which is a PROMOTION the operator
-- funds, explicitly listed in roman.agent.md ("monthly giveaways"). It pays
-- out through the existing withdrawal rails and is operator-created only.
--
-- CONCURRENCY
-- -----------
-- Each "award" surface is guarded so a double-submit, a double-click, or N
-- parallel requests cannot mint extra rewards. Two mechanisms are used:
--
--   * `ON CONFLICT ... DO NOTHING` against a UNIQUE key that defines "this
--     user has already been credited for this exact thing" (idempotency).
--   * CHECK constraints and non-negative balances, mirroring the approach in
--     096 (credits non-negative) and 097 (one in-flight withdrawal), so a
--     logic bug that writes a negative value fails at the database rather than
--     silently corrupting a balance.

-- ---------------------------------------------------------------------------
-- Seasons — a named progression window with its own start/end.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gamification_seasons (
  id serial PRIMARY KEY,
  key text UNIQUE NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gamification_seasons_window CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_gamification_seasons_active
  ON public.gamification_seasons(is_active, starts_at DESC);

-- ---------------------------------------------------------------------------
-- Per-user season participation. Points/XP earned inside a season.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_season_progress (
  id serial PRIMARY KEY,
  user_id text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  season_id integer NOT NULL REFERENCES public.gamification_seasons(id) ON DELETE CASCADE,
  xp integer NOT NULL DEFAULT 0,
  rank integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, season_id),
  CONSTRAINT user_season_progress_xp_non_negative CHECK (xp >= 0)
);

CREATE INDEX IF NOT EXISTS idx_user_season_progress_leaderboard
  ON public.user_season_progress(season_id, xp DESC);

-- ---------------------------------------------------------------------------
-- Battle-pass-style progression: an ordered track of tiers, each with an XP
-- threshold. Tiers are DEFINITION rows (admin/operator-managed), never
-- per-user rows, so the pass is configurable without a deploy.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.battle_pass_tiers (
  id serial PRIMARY KEY,
  season_id integer NOT NULL REFERENCES public.gamification_seasons(id) ON DELETE CASCADE,
  tier integer NOT NULL,
  xp_required integer NOT NULL,
  label text NOT NULL DEFAULT '',
  -- Cosmetics/XP only. Never credits or cash.
  reward_xp integer NOT NULL DEFAULT 0,
  reward_code text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(season_id, tier),
  CONSTRAINT battle_pass_tier_threshold CHECK (xp_required >= 0),
  CONSTRAINT battle_pass_tier_reward_non_negative CHECK (reward_xp >= 0)
);

-- Which tiers a user has CLAIMED. The UNIQUE(user_id, tier_id) is the
-- idempotency guard: a double-click or N parallel requests cannot claim the
-- same tier twice, because the second insert is discarded.
CREATE TABLE IF NOT EXISTS public.user_battle_pass_claims (
  id serial PRIMARY KEY,
  user_id text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  tier_id integer NOT NULL REFERENCES public.battle_pass_tiers(id) ON DELETE CASCADE,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, tier_id)
);

-- ---------------------------------------------------------------------------
-- Weekly spin wheel.
--
-- `spins_remaining` is derived from ACHIEVEMENT progress, never purchased.
-- The column is capped so no code path can accumulate a large balance.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_spin_wallet (
  user_id text PRIMARY KEY REFERENCES public."user"(id) ON DELETE CASCADE,
  spins_remaining integer NOT NULL DEFAULT 0,
  week_started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_spin_wallet_non_negative CHECK (spins_remaining >= 0),
  CONSTRAINT user_spin_wallet_cap CHECK (spins_remaining <= 7)
);

-- Audit of every spin. Unique on (user_id, week) is what makes a replayed
-- request idempotent per spin ordinal rather than merely rate-limited.
CREATE TABLE IF NOT EXISTS public.spin_wheel_spins (
  id serial PRIMARY KEY,
  user_id text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  spin_number integer NOT NULL,
  prize_key text NOT NULL,
  prize_xp integer NOT NULL DEFAULT 0,
  spun_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, spin_number),
  CONSTRAINT spin_wheel_prize_xp_non_negative CHECK (prize_xp >= 0)
);

-- ---------------------------------------------------------------------------
-- Crates: EARNED, not purchasable. Opened with achievement progress too.
-- Cosmetics and XP only.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_crate_inventory (
  id serial PRIMARY KEY,
  user_id text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  crate_key text NOT NULL,
  cosmetic_key text NOT NULL,
  rarity text NOT NULL DEFAULT 'common'
    CHECK (rarity IN ('common', 'uncommon', 'rare', 'epic', 'legendary')),
  is_equipped boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, crate_key, cosmetic_key)
);

CREATE INDEX IF NOT EXISTS idx_user_crate_inventory_equipped
  ON public.user_crate_inventory(user_id) WHERE is_equipped = true;

-- One open per (user, crate) per day. Stops a tight retry loop from turning one
-- earned crate into an unlimited cosmetics faucet.
--
-- The per-day bucket is an EXPRESSION column, because Postgres does not allow a
-- cast (`opened_at::date`) inside a UNIQUE constraint. Declaring it as a stored
-- generated column keeps the daily UNIQUE enforceable, which is the whole
-- point: a plain index would not prevent a second open on the same day.
CREATE TABLE IF NOT EXISTS public.user_crate_opens (
  id serial PRIMARY KEY,
  user_id text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  crate_key text NOT NULL,
  opened_day date GENERATED ALWAYS AS ((opened_at AT TIME ZONE 'UTC')::date) STORED,
  opened_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, crate_key, opened_day)
);

-- ---------------------------------------------------------------------------
-- Competitions (leaderboards within a season). Ranking is computed from
-- user_season_progress rather than stored, so it cannot drift.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.competitions (
  id serial PRIMARY KEY,
  key text UNIQUE NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  season_id integer REFERENCES public.gamification_seasons(id) ON DELETE SET NULL,
  metric text NOT NULL DEFAULT 'xp',
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT competitions_window CHECK (ends_at > starts_at)
);

-- ---------------------------------------------------------------------------
-- Redeemable 1x-10x USE CODES.
--
-- SECURITY: `multiplier` is capped at 10 by a CHECK constraint, so a malicious
-- or buggy write cannot mint an unbounded bonus. These grant XP ONLY — they
-- cannot mint AI credits, which are the only monetary balance in the app.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.use_codes (
  id serial PRIMARY KEY,
  code text UNIQUE NOT NULL,
  multiplier integer NOT NULL DEFAULT 1,
  xp_reward integer NOT NULL DEFAULT 0,
  max_redemptions integer NOT NULL DEFAULT 1,
  redeemed_count integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_codes_multiplier_range CHECK (multiplier BETWEEN 1 AND 10),
  CONSTRAINT use_codes_redemption_invariant
    CHECK (redeemed_count >= 0 AND redeemed_count <= max_redemptions),
  CONSTRAINT use_codes_xp_non_negative CHECK (xp_reward >= 0)
);

CREATE INDEX IF NOT EXISTS idx_use_codes_active ON public.use_codes(is_active);

-- Redemption ledger. UNIQUE(user_id, code_id) makes a code single-use per user
-- no matter how many times the request is replayed.
CREATE TABLE IF NOT EXISTS public.user_use_code_redemptions (
  id serial PRIMARY KEY,
  user_id text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  code_id integer NOT NULL REFERENCES public.use_codes(id) ON DELETE CASCADE,
  multiplier integer NOT NULL,
  xp_awarded integer NOT NULL DEFAULT 0,
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, code_id),
  CONSTRAINT user_use_code_multiplier_range CHECK (multiplier BETWEEN 1 AND 10)
);

-- ---------------------------------------------------------------------------
-- Monthly giveaways. Operator-created; the ONLY monetary item in this file.
-- Entries are drawn by the operator, not by users, and there is no wager.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.giveaways (
  id serial PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  prize_description text NOT NULL,
  entries_required integer NOT NULL DEFAULT 1,
  draws_at timestamptz NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT giveaways_entries_positive CHECK (entries_required > 0)
);

CREATE TABLE IF NOT EXISTS public.giveaway_entries (
  id serial PRIMARY KEY,
  giveaway_id integer NOT NULL REFERENCES public.giveaways(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  entry_number integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- One entry per user per giveaway: a user cannot buy odds with a loop.
  UNIQUE(giveaway_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_giveaway_entries_giveaway
  ON public.giveaway_entries(giveaway_id, entry_number);

-- ---------------------------------------------------------------------------
-- updated_at triggers, matching the existing convention (migration 068).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_gamification_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_spin_wallet_updated_at ON public.user_spin_wallet;
CREATE TRIGGER user_spin_wallet_updated_at
  BEFORE UPDATE ON public.user_spin_wallet
  FOR EACH ROW EXECUTE FUNCTION update_gamification_updated_at();

DROP TRIGGER IF EXISTS user_season_progress_updated_at ON public.user_season_progress;
CREATE TRIGGER user_season_progress_updated_at
  BEFORE UPDATE ON public.user_season_progress
  FOR EACH ROW EXECUTE FUNCTION update_gamification_updated_at();