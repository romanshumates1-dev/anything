-- ============================================================================
-- Migration 069 — ChatGPT/Anthropic-style tiered rate limits
--
-- Adds daily, weekly, and monthly usage caps per subscription tier.
-- Similar to how ChatGPT limits messages per 3 hours and Anthropic limits
-- messages per day for different tiers.
--
-- RATE LIMITS BY TIER:
--
-- Free:
--   - Daily: 10 AI requests, 5 SMS, 25 emails
--   - Weekly: 50 AI requests, 25 SMS, 100 emails
--   - Monthly: 50 AI requests (hard cap), 0 SMS, 25 emails
--
-- Starter ($129/mo):
--   - Daily: 50 AI requests, 25 SMS, 100 emails
--   - Weekly: 250 AI requests, 100 SMS, 500 emails
--   - Monthly: 250 AI credits, 100 SMS, 500 emails
--
-- Pro ($399/mo):
--   - Daily: 300 AI requests, 75 SMS, 500 emails
--   - Weekly: 1,500 AI requests, 300 SMS, 2,500 emails
--   - Monthly: 1,500 AI credits, 300 SMS, 2,500 emails
--
-- Business ($899/mo):
--   - Daily: 1,000 AI requests, 250 SMS, 2,000 emails
--   - Weekly: 5,000 AI requests, 1,000 SMS, 10,000 emails
--   - Monthly: 5,000 AI credits, 1,000 SMS, 10,000 emails
--
-- Scale ($2,499/mo):
--   - Daily: 4,000 AI requests, 750 SMS, 10,000 emails
--   - Weekly: 20,000 AI requests, 3,000 SMS, 50,000 emails
--   - Monthly: 20,000 AI credits, 3,000 SMS, 50,000 emails
--
-- Enterprise: Unlimited (no rate limits)
-- ============================================================================

BEGIN;

-- Add rate limit columns to subscription_plans limits JSONB
-- Update Free tier with rate limits
UPDATE public.subscription_plans
SET limits = limits || '{
  "daily_ai_requests": 10,
  "daily_sms": 5,
  "daily_emails": 25,
  "weekly_ai_requests": 50,
  "weekly_sms": 25,
  "weekly_emails": 100,
  "cooldown_minutes_after_limit": 60,
  "rate_limit_reset_hour_utc": 0
}'::jsonb,
updated_at = now()
WHERE tier = 'free';

-- Update Starter tier with rate limits
UPDATE public.subscription_plans
SET limits = limits || '{
  "daily_ai_requests": 50,
  "daily_sms": 25,
  "daily_emails": 100,
  "weekly_ai_requests": 250,
  "weekly_sms": 100,
  "weekly_emails": 500,
  "cooldown_minutes_after_limit": 30,
  "rate_limit_reset_hour_utc": 0
}'::jsonb,
updated_at = now()
WHERE tier = 'starter';

-- Update Pro tier with rate limits
UPDATE public.subscription_plans
SET limits = limits || '{
  "daily_ai_requests": 300,
  "daily_sms": 75,
  "daily_emails": 500,
  "weekly_ai_requests": 1500,
  "weekly_sms": 300,
  "weekly_emails": 2500,
  "cooldown_minutes_after_limit": 15,
  "rate_limit_reset_hour_utc": 0
}'::jsonb,
updated_at = now()
WHERE tier = 'pro' OR tier = 'professional';

-- Update Business tier with rate limits
UPDATE public.subscription_plans
SET limits = limits || '{
  "daily_ai_requests": 1000,
  "daily_sms": 250,
  "daily_emails": 2000,
  "weekly_ai_requests": 5000,
  "weekly_sms": 1000,
  "weekly_emails": 10000,
  "cooldown_minutes_after_limit": 5,
  "rate_limit_reset_hour_utc": 0
}'::jsonb,
updated_at = now()
WHERE tier = 'business';

-- Update Scale tier with rate limits
UPDATE public.subscription_plans
SET limits = limits || '{
  "daily_ai_requests": 4000,
  "daily_sms": 750,
  "daily_emails": 10000,
  "weekly_ai_requests": 20000,
  "weekly_sms": 3000,
  "weekly_emails": 50000,
  "cooldown_minutes_after_limit": 0,
  "rate_limit_reset_hour_utc": 0
}'::jsonb,
updated_at = now()
WHERE tier = 'scale';

-- Update Enterprise tier (unlimited)
UPDATE public.subscription_plans
SET limits = limits || '{
  "daily_ai_requests": -1,
  "daily_sms": -1,
  "daily_emails": -1,
  "weekly_ai_requests": -1,
  "weekly_sms": -1,
  "weekly_emails": -1,
  "cooldown_minutes_after_limit": 0,
  "rate_limit_reset_hour_utc": 0
}'::jsonb,
updated_at = now()
WHERE tier = 'enterprise';

-- Create rate limit tracking table for efficient lookups
CREATE TABLE IF NOT EXISTS public.rate_limit_buckets (
  id serial PRIMARY KEY,
  user_id text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  organization_id uuid,
  metric_type text NOT NULL, -- 'ai_request', 'sms', 'email'
  period_type text NOT NULL, -- 'daily', 'weekly', 'monthly'
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  usage_count integer NOT NULL DEFAULT 0,
  limit_value integer NOT NULL,
  limit_hit_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, metric_type, period_type, period_start)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_user_period
  ON public.rate_limit_buckets(user_id, metric_type, period_type, period_start DESC);

CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_org_period
  ON public.rate_limit_buckets(organization_id, metric_type, period_type, period_start DESC)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_active
  ON public.rate_limit_buckets(user_id, period_end)
  WHERE period_end > now();

-- Create rate limit events log for analytics and debugging
CREATE TABLE IF NOT EXISTS public.rate_limit_events (
  id serial PRIMARY KEY,
  user_id text NOT NULL,
  organization_id uuid,
  metric_type text NOT NULL,
  period_type text NOT NULL,
  event_type text NOT NULL, -- 'limit_hit', 'limit_warning', 'usage_recorded'
  usage_count integer NOT NULL,
  limit_value integer NOT NULL,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for recent events lookup
CREATE INDEX IF NOT EXISTS idx_rate_limit_events_user_recent
  ON public.rate_limit_events(user_id, created_at DESC);

-- Partition by month for efficient cleanup (optional, for high-volume)
-- CREATE INDEX IF NOT EXISTS idx_rate_limit_events_created
--   ON public.rate_limit_events(created_at);

-- Function to get or create rate limit bucket for current period
CREATE OR REPLACE FUNCTION get_or_create_rate_bucket(
  p_user_id text,
  p_org_id uuid,
  p_metric_type text,
  p_period_type text,
  p_limit_value integer
) RETURNS public.rate_limit_buckets AS $$
DECLARE
  v_bucket public.rate_limit_buckets;
  v_period_start timestamptz;
  v_period_end timestamptz;
BEGIN
  -- Calculate period boundaries
  IF p_period_type = 'daily' THEN
    v_period_start := date_trunc('day', now() AT TIME ZONE 'UTC');
    v_period_end := v_period_start + interval '1 day' - interval '1 second';
  ELSIF p_period_type = 'weekly' THEN
    -- Week starts on Monday
    v_period_start := date_trunc('week', now() AT TIME ZONE 'UTC');
    v_period_end := v_period_start + interval '7 days' - interval '1 second';
  ELSIF p_period_type = 'monthly' THEN
    v_period_start := date_trunc('month', now() AT TIME ZONE 'UTC');
    v_period_end := (v_period_start + interval '1 month') - interval '1 second';
  ELSE
    RAISE EXCEPTION 'Invalid period_type: %', p_period_type;
  END IF;

  -- Try to get existing bucket
  SELECT * INTO v_bucket
  FROM public.rate_limit_buckets
  WHERE user_id = p_user_id
    AND metric_type = p_metric_type
    AND period_type = p_period_type
    AND period_start = v_period_start;

  -- Create if not exists
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

-- Function to check and increment rate limit
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_user_id text,
  p_org_id uuid,
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
  -- Get or create bucket
  v_bucket := get_or_create_rate_bucket(p_user_id, p_org_id, p_metric_type, p_period_type, p_limit_value);

  -- -1 means unlimited
  IF p_limit_value = -1 THEN
    -- Update usage count even for unlimited (for analytics)
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

  -- Check if within limit
  v_allowed := (v_bucket.usage_count + p_increment) <= p_limit_value;
  v_remaining := GREATEST(0, p_limit_value - v_bucket.usage_count - p_increment);

  IF v_allowed THEN
    -- Increment usage
    UPDATE public.rate_limit_buckets
    SET usage_count = usage_count + p_increment, updated_at = now()
    WHERE id = v_bucket.id;

    -- Log if approaching limit (80%)
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
    -- Record limit hit if first time
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

-- View for current user rate limits summary
CREATE OR REPLACE VIEW public.user_rate_limits AS
SELECT
  u.id as user_id,
  u.email,
  COALESCE(os.plan_id, 'plan_free') as plan_id,
  p.tier,
  p.name as plan_name,
  -- Daily limits
  (p.limits->>'daily_ai_requests')::int as daily_ai_limit,
  (p.limits->>'daily_sms')::int as daily_sms_limit,
  (p.limits->>'daily_emails')::int as daily_email_limit,
  -- Weekly limits
  (p.limits->>'weekly_ai_requests')::int as weekly_ai_limit,
  (p.limits->>'weekly_sms')::int as weekly_sms_limit,
  (p.limits->>'weekly_emails')::int as weekly_email_limit,
  -- Monthly limits
  (p.limits->>'monthly_ai_credits')::int as monthly_ai_limit,
  (p.limits->>'monthly_sms_allowance')::int as monthly_sms_limit,
  (p.limits->>'monthly_email_allowance')::int as monthly_email_limit,
  -- Cooldown
  (p.limits->>'cooldown_minutes_after_limit')::int as cooldown_minutes
FROM public."user" u
LEFT JOIN organization_members om ON om.user_id = u.id
LEFT JOIN organization_subscriptions os ON os.organization_id = om.organization_id AND os.status IN ('active', 'trial')
LEFT JOIN subscription_plans p ON p.id = COALESCE(os.plan_id, 'plan_free');

COMMIT;
