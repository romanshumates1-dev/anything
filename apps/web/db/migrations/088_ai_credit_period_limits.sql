-- 088_ai_credit_period_limits.sql
-- Phase 11: weekly + daily INCLUDED-credit limits for AI usage.
--
-- Rules (server-side authoritative):
--   monthly included allowance = M
--   weekly included cap        = floor(M / 4)    (at most 1/4 of the monthly included credits)
--   daily  included cap        = floor(M / 20)   (at most 1/5 of the weekly included limit)
--
-- Included credits are tracked per UTC period (day / ISO week / calendar month) in their own
-- counters. Purchased credits are a separate bucket stored in `credit_balances` and are NEVER
-- blocked by these caps — the application only falls back to them once included credits are
-- exhausted or capped.
--
-- All consumption goes through `consume_ai_included_credit`, which locks the three counter rows
-- (deterministic key order) and increments all windows in a single atomic statement sequence, so
-- concurrent requests cannot overspend the caps (no TOCTOU window).
--
-- Idempotent: safe to re-run. Additive only — no existing table, column or row is modified.

CREATE TABLE IF NOT EXISTS ai_credit_period_usage (
  organization_id TEXT        NOT NULL,
  -- 'day:2026-03-04' | 'week:2026-W10' | 'month:2026-03'
  period_key      TEXT        NOT NULL,
  period_kind     TEXT        NOT NULL CHECK (period_kind IN ('day', 'week', 'month')),
  credits_used    BIGINT      NOT NULL DEFAULT 0 CHECK (credits_used >= 0),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, period_key)
);

CREATE INDEX IF NOT EXISTS idx_ai_credit_period_usage_org_kind
  ON ai_credit_period_usage (organization_id, period_kind);

COMMENT ON TABLE ai_credit_period_usage IS
  'Phase 11 included-AI-credit period counters (day/week/month, UTC). Purchased credits live in credit_balances and are exempt from these caps.';

-- Atomically consume ONE included credit across the day/week/month windows.
-- Returns JSONB: { ok: true, day, week, month } | { ok: false, reason }
--   reasons: missing_organization | daily_limit | weekly_limit | monthly_limit
CREATE OR REPLACE FUNCTION consume_ai_included_credit(
  p_organization_id TEXT,
  p_day_key         TEXT,
  p_week_key        TEXT,
  p_month_key       TEXT,
  p_daily_cap       INTEGER,
  p_weekly_cap      INTEGER,
  p_monthly_cap     INTEGER
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_day   BIGINT;
  v_week  BIGINT;
  v_month BIGINT;
BEGIN
  IF p_organization_id IS NULL OR p_organization_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_organization');
  END IF;

  -- Ensure the three counter rows exist (idempotent, insert-if-absent).
  INSERT INTO ai_credit_period_usage (organization_id, period_key, period_kind, credits_used)
  VALUES
    (p_organization_id, 'day:'   || p_day_key,   'day',   0),
    (p_organization_id, 'week:'  || p_week_key,  'week',  0),
    (p_organization_id, 'month:' || p_month_key, 'month', 0)
  ON CONFLICT (organization_id, period_key) DO NOTHING;

  -- Lock the three rows in a deterministic key order so concurrent callers serialise
  -- without deadlocking against each other.
  PERFORM 1
  FROM ai_credit_period_usage
  WHERE organization_id = p_organization_id
    AND period_key IN ('day:' || p_day_key, 'week:' || p_week_key, 'month:' || p_month_key)
  ORDER BY period_key
  FOR UPDATE;

  SELECT
    COALESCE(MAX(credits_used) FILTER (WHERE period_kind = 'day'),   0),
    COALESCE(MAX(credits_used) FILTER (WHERE period_kind = 'week'),  0),
    COALESCE(MAX(credits_used) FILTER (WHERE period_kind = 'month'), 0)
  INTO v_day, v_week, v_month
  FROM ai_credit_period_usage
  WHERE organization_id = p_organization_id
    AND period_key IN ('day:' || p_day_key, 'week:' || p_week_key, 'month:' || p_month_key);

  IF p_daily_cap > 0 AND v_day >= p_daily_cap THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'daily_limit',
      'day', v_day, 'week', v_week, 'month', v_month);
  END IF;
  IF p_weekly_cap > 0 AND v_week >= p_weekly_cap THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'weekly_limit',
      'day', v_day, 'week', v_week, 'month', v_month);
  END IF;
  IF p_monthly_cap > 0 AND v_month >= p_monthly_cap THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'monthly_limit',
      'day', v_day, 'week', v_week, 'month', v_month);
  END IF;

  UPDATE ai_credit_period_usage
  SET credits_used = credits_used + 1,
      updated_at   = NOW()
  WHERE organization_id = p_organization_id
    AND period_key IN ('day:' || p_day_key, 'week:' || p_week_key, 'month:' || p_month_key);

  RETURN jsonb_build_object('ok', true,
    'day', v_day + 1, 'week', v_week + 1, 'month', v_month + 1);
END;
$$;

COMMENT ON FUNCTION consume_ai_included_credit(TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, INTEGER) IS
  'Phase 11: atomically consume one included AI credit across day/week/month windows; denies when any window is capped. Purchased credits are unaffected.';

-- Compensating release used when an AI call fails AFTER included credits were consumed.
-- Never goes below zero; safe to call repeatedly (each call releases at most one credit).
CREATE OR REPLACE FUNCTION release_ai_included_credit(
  p_organization_id TEXT,
  p_day_key         TEXT,
  p_week_key        TEXT,
  p_month_key       TEXT
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_organization_id IS NULL OR p_organization_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_organization');
  END IF;

  UPDATE ai_credit_period_usage
  SET credits_used = GREATEST(credits_used - 1, 0),
      updated_at   = NOW()
  WHERE organization_id = p_organization_id
    AND period_key IN ('day:' || p_day_key, 'week:' || p_week_key, 'month:' || p_month_key);

  RETURN jsonb_build_object('ok', true);
END;
$$;

COMMENT ON FUNCTION release_ai_included_credit(TEXT, TEXT, TEXT, TEXT) IS
  'Phase 11: compensating release of one included AI credit (floored at zero) when the AI call fails after consumption.';
