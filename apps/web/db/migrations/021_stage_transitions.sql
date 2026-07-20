-- 021_stage_transitions.sql
-- Phase P4: Funnel analytics — stage_transitions event table.
-- Written at every state-machine transition going forward.
-- Best-effort backfill from audit logs with a backfilled flag.
-- Idempotent. Rollback: DROP TABLE stage_transitions;

CREATE TABLE IF NOT EXISTS public.stage_transitions (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lead_id       bigint NOT NULL,
  from_stage    text,
  to_stage      text NOT NULL,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  campaign_id   text,
  profile_id    text,
  channel       text,  -- 'sms', 'voice', 'rvm', 'inbound', 'system'
  backfilled    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Fast lookup by lead (for timeline).
CREATE INDEX IF NOT EXISTS idx_stage_transitions_lead
  ON public.stage_transitions (lead_id, occurred_at);

-- Fast lookup by campaign (for funnel aggregation).
CREATE INDEX IF NOT EXISTS idx_stage_transitions_campaign
  ON public.stage_transitions (campaign_id, occurred_at);

-- Fast lookup by time range (for date-filtered queries).
CREATE INDEX IF NOT EXISTS idx_stage_transitions_occurred
  ON public.stage_transitions (occurred_at);

COMMENT ON TABLE public.stage_transitions IS
  'Phase P4: Funnel analytics. Every state-machine transition is recorded here for conversion analysis.';