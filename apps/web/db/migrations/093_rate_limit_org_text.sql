-- 093: rate-limit organization_id uuid -> text (defect #34)
--
-- WHY
-- ---
-- Migration 069 created the rate-limit subsystem with `organization_id uuid`
-- and the same type on `get_or_create_rate_bucket` / `check_rate_limit`. But
-- organization ids are TEXT everywhere else in this schema
-- (`organizations.id text`, `organization_members.organization_id text`, values
-- shaped `org_<hex>`), and `api/services/rateLimiter.ts` passed that value
-- through with an explicit `${organizationId}::uuid` cast to satisfy the old
-- signature.
--
-- The result was a hard 500 on every rate-limited endpoint for every real
-- organization:
--     invalid input syntax for type uuid: "org_cd89832ebdc7484dbf9aef9f3db81253"
-- raised from checkSingleRateLimit -> checkRateLimit. That took out AI support
-- chat, template generation, the AI analytics endpoint and anything else behind
-- `checkRateLimit(..., 'ai_request')` - the paid features.
--
-- THE FIX
-- -------
-- Align the column and function types with the rest of the schema (text).
-- Widening conversion, so lossless; existing rows cast trivially. The `::uuid`
-- cast in rateLimiter.ts is removed in the same change.
--
-- Idempotent: the column conversion is guarded on the CURRENT type, the old
-- signatures are dropped IF EXISTS, and CREATE OR REPLACE makes the new
-- definitions re-runnable.

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['rate_limit_buckets', 'rate_limit_events'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = tbl
        AND column_name = 'organization_id'
        AND data_type = 'uuid'
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ALTER COLUMN organization_id TYPE text USING organization_id::text',
        tbl
      );
    END IF;
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.get_or_create_rate_bucket(text, uuid, text, text, integer);
DROP FUNCTION IF EXISTS public.check_rate_limit(text, uuid, text, text, integer, integer);

CREATE OR REPLACE FUNCTION get_or_create_rate_bucket(
  p_user_id text,
  p_org_id text,
  p_metric_type text,
  p_period_type text,
  p_limit_value integer
) RETURNS public.rate_limit_buckets AS $$
DECLARE
  v_bucket public.rate_limit_buckets;
  v_period_start timestamptz;
  v_period_end timestamptz;
BEGIN
  IF p_period_type = 'daily' THEN
    v_period_start := date_trunc('day', now() AT TIME ZONE 'UTC');
    v_period_end := v_period_start + interval '1 day' - interval '1 second';
  ELSIF p_period_type = 'weekly' THEN
    v_period_start := date_trunc('week', now() AT TIME ZONE 'UTC');
    v_period_end := v_period_start + interval '7 days' - interval '1 second';
  ELSIF p_period_type = 'monthly' THEN
    v_period_start := date_trunc('month', now() AT TIME ZONE 'UTC');
    v_period_end := (v_period_start + interval '1 month') - interval '1 second';
  ELSE
    RAISE EXCEPTION 'Invalid period_type: %', p_period_type;
  END IF;

  SELECT * INTO v_bucket
  FROM public.rate_limit_buckets
  WHERE user_id = p_user_id
    AND metric_type = p_metric_type
    AND period_type = p_period_type
    AND period_start = v_period_start;

  IF v_bucket.id IS NULL THEN
    INSERT INTO public.rate_limit_buckets (
      user_id, organization_id, metric_type, period_type,
      period_start, period_end, usage_count, limit_value
    ) VALUES (
      p_user_id, p_org_id, p_metric_type, p_period_type,
      v_period_start, v_period_end, 0, p_limit_value
    )
    RETURNING * INTO v_bucket;
  END IF;

  RETURN v_bucket;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION check_rate_limit(
  p_user_id text,
  p_org_id text,
  p_metric_type text,
  p_period_type text,
  p_limit_value integer,
  p_increment integer DEFAULT 1
) RETURNS TABLE (
  allowed boolean,
  current_usage integer,
  limit_value integer,
  remaining integer,
  resets_at timestamptz,
  cooldown_until timestamptz
) AS $$
DECLARE
  v_bucket public.rate_limit_buckets;
  v_allowed boolean;
  v_remaining integer;
  v_cooldown_minutes integer;
BEGIN
  v_bucket := get_or_create_rate_bucket(p_user_id, p_org_id, p_metric_type, p_period_type, p_limit_value);

  IF p_limit_value = -1 THEN
    UPDATE public.rate_limit_buckets
    SET usage_count = usage_count + p_increment, updated_at = now()
    WHERE id = v_bucket.id;

    RETURN QUERY SELECT
      true AS allowed,
      v_bucket.usage_count + p_increment AS current_usage,
      -1 AS limit_value,
      -1 AS remaining,
      v_bucket.period_end AS resets_at,
      NULL::timestamptz AS cooldown_until;
    RETURN;
  END IF;

  v_allowed := (v_bucket.usage_count + p_increment) <= p_limit_value;
  v_remaining := GREATEST(0, p_limit_value - v_bucket.usage_count - p_increment);

  IF v_allowed THEN
    UPDATE public.rate_limit_buckets
    SET usage_count = usage_count + p_increment, updated_at = now()
    WHERE id = v_bucket.id;

    IF (v_bucket.usage_count + p_increment) >= (p_limit_value * 0.8) THEN
      INSERT INTO public.rate_limit_events (
        user_id, organization_id, metric_type, period_type,
        event_type, usage_count, limit_value
      ) VALUES (
        p_user_id, p_org_id, p_metric_type, p_period_type,
        'limit_warning', v_bucket.usage_count + p_increment, p_limit_value
      );
    END IF;
  ELSE
    IF v_bucket.limit_hit_at IS NULL THEN
      UPDATE public.rate_limit_buckets
      SET limit_hit_at = now(), updated_at = now()
      WHERE id = v_bucket.id;

      INSERT INTO public.rate_limit_events (
        user_id, organization_id, metric_type, period_type,
        event_type, usage_count, limit_value
      ) VALUES (
        p_user_id, p_org_id, p_metric_type, p_period_type,
        'limit_hit', v_bucket.usage_count, p_limit_value
      );
    END IF;
  END IF;

  RETURN QUERY SELECT
    v_allowed AS allowed,
    v_bucket.usage_count + CASE WHEN v_allowed THEN p_increment ELSE 0 END AS current_usage,
    p_limit_value AS limit_value,
    v_remaining AS remaining,
    v_bucket.period_end AS resets_at,
    CASE WHEN NOT v_allowed THEN v_bucket.limit_hit_at + interval '1 minute' * COALESCE(v_cooldown_minutes, 0) ELSE NULL END AS cooldown_until;
END;
$$ LANGUAGE plpgsql;
