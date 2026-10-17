-- Migration 102 — atomic achievement unlock + points award
--
-- WHY
-- ---
-- `POST /api/achievements` credits `user_stats.points` when an achievement
-- transitions from locked to unlocked. The inline upsert reads `was_unlocked`
-- and then writes in separate statements, so two concurrent callers racing on
-- a never-touched achievement both read `was_unlocked = false`, both see the
-- row become unlocked, and both are credited. This is the documented XP
-- double-award race residual (see achievements/route.ts).
--
-- This migration adds `award_achievement(...)`, a PL/pgSQL function that
-- performs the whole transition + payout atomically: it ensures a row exists,
-- locks it FOR UPDATE, reads the pre-existing unlocked flag, applies the
-- monotonic upsert, and pays points ONLY on a real locked→unlocked transition.
-- Concurrent callers serialize on the row lock, so exactly one payout occurs.
--
-- Idempotent: safe to re-run. Additive only — no existing table, column or row
-- is modified.

CREATE OR REPLACE FUNCTION award_achievement(
  p_user_id        TEXT,
  p_achievement_id INTEGER,
  p_progress       INTEGER,
  p_should_unlock  BOOLEAN,
  p_points         INTEGER
) RETURNS TABLE (
  progress       INTEGER,
  unlocked       BOOLEAN,
  just_unlocked  BOOLEAN,
  points_awarded INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_was_unlocked BOOLEAN;
  v_progress     INTEGER;
  v_unlocked     BOOLEAN;
  v_unlocked_at  TIMESTAMPTZ;
BEGIN
  -- Ensure a row exists so concurrent upserts serialize on the row lock.
  -- The INSERT winner creates the row; the loser gets DO NOTHING and then
  -- blocks on the FOR UPDATE below until the winner commits.
  INSERT INTO user_achievements (user_id, achievement_id, progress, unlocked, unlocked_at, updated_at)
  VALUES (p_user_id, p_achievement_id, 0, false, NULL, NOW())
  ON CONFLICT (user_id, achievement_id) DO NOTHING;

  -- Serialize all concurrent upserts on this (user, achievement) pair.
  SELECT user_achievements.unlocked INTO v_was_unlocked
  FROM user_achievements
  WHERE user_id = p_user_id AND achievement_id = p_achievement_id
  FOR UPDATE;

  -- Apply the monotonic upsert. Progress only ever increases; unlock state
  -- only ever flips false→true; the original unlock timestamp is preserved.
  UPDATE user_achievements
  SET progress      = GREATEST(user_achievements.progress, p_progress),
      unlocked      = user_achievements.unlocked OR p_should_unlock,
      unlocked_at   = COALESCE(user_achievements.unlocked_at,
                             CASE WHEN p_should_unlock THEN NOW() ELSE NULL END),
      updated_at    = NOW()
  WHERE user_id = p_user_id AND achievement_id = p_achievement_id
  RETURNING user_achievements.progress, user_achievements.unlocked, user_achievements.unlocked_at
  INTO v_progress, v_unlocked, v_unlocked_at;

  -- Pay points only on a real locked→unlocked transition caused by this call.
  IF NOT v_was_unlocked AND v_unlocked THEN
    INSERT INTO user_stats (user_id, points)
    VALUES (p_user_id, p_points)
    ON CONFLICT (user_id) DO UPDATE SET
      points      = COALESCE(user_stats.points, 0) + p_points,
      updated_at  = NOW();

    RETURN QUERY SELECT v_progress, v_unlocked, true, p_points;
  ELSE
    RETURN QUERY SELECT v_progress, v_unlocked, false, 0;
  END IF;
END;
$$;

COMMENT ON FUNCTION award_achievement(TEXT, INTEGER, INTEGER, BOOLEAN, INTEGER) IS
  'Atomically upserts a user_achievements row and awards points only on a real '
  'locked→unlocked transition. Serializes concurrent callers via FOR UPDATE so '
  'the same achievement cannot be paid out twice under concurrency.';
