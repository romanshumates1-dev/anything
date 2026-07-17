-- 010_number_pool.sql
-- INT-3: local-presence number pool.
--
-- Selection (area-code exact -> nearest region -> least-used) is pure code in
-- utils/numberPool.ts; this table is only storage + the daily counter.
--
-- daily_sent/last_reset_date implement the daily reset WITHOUT a cron: any read
-- through numberPoolStore treats a row whose last_reset_date < today (UTC) as
-- daily_sent=0 and lazily resets it. A missed cron therefore cannot cause an
-- over-send, and a clock skew cannot silently raise the cap.
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.number_pool (
  id               serial PRIMARY KEY,
  phone_number     text NOT NULL UNIQUE,
  area_code        text NOT NULL,
  number_type      text NOT NULL DEFAULT '10dlc',
  trust_level      text NOT NULL DEFAULT 'medium',
  daily_sent       integer NOT NULL DEFAULT 0,
  last_reset_date  date NOT NULL DEFAULT CURRENT_DATE,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT number_pool_type_chk  CHECK (number_type IN ('10dlc','toll-free','short-code')),
  CONSTRAINT number_pool_trust_chk CHECK (trust_level IN ('low','medium','high')),
  CONSTRAINT number_pool_sent_chk  CHECK (daily_sent >= 0)
);

-- Selection filters on active numbers and orders by usage.
CREATE INDEX IF NOT EXISTS number_pool_active_idx ON public.number_pool (active, area_code);
CREATE INDEX IF NOT EXISTS number_pool_usage_idx  ON public.number_pool (daily_sent);

COMMENT ON TABLE public.number_pool IS
  'INT-3 local-presence pool. daily_sent is reset lazily on read when last_reset_date < today (UTC) - no cron dependency. Effective cap = min(rotationCap setting, computeDailyCapacity(number)); see utils/numberPool.ts.';
COMMENT ON COLUMN public.number_pool.daily_sent IS
  'Sends today. Authoritative only together with last_reset_date - read via numberPoolStore, never raw.';
