-- ============================================================================
-- INT-1: SLA latency instrumentation + ack-SMS tracking
-- ============================================================================

-- Tracks reply_received → ai_dispatched latency per inbound message.
-- One row per inbound reply that triggers an AI job. Used for rolling P95.
CREATE TABLE IF NOT EXISTS public.inbound_latency (
  id serial PRIMARY KEY,
  conversation_id integer NOT NULL,
  lead_id integer NOT NULL,
  reply_received_at timestamptz NOT NULL,
  ai_dispatched_at timestamptz,
  ack_sent_at timestamptz,
  provider text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inbound_latency_conv ON public.inbound_latency (conversation_id);
CREATE INDEX IF NOT EXISTS idx_inbound_latency_received ON public.inbound_latency (reply_received_at);

-- Rolling P95 materialized view (refreshed on demand or by cron)
-- Window: last 24 hours of completed dispatches.
CREATE MATERIALIZED VIEW IF NOT EXISTS public.inbound_latency_p95 AS
SELECT
  percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (ai_dispatched_at - reply_received_at)) * 1000) AS p95_ms,
  COUNT(*) FILTER (WHERE ai_dispatched_at IS NOT NULL) AS completed_count,
  COUNT(*) FILTER (WHERE ai_dispatched_at IS NULL) AS pending_count,
  MAX(reply_received_at) AS latest_inbound,
  now() AS computed_at
FROM public.inbound_latency
WHERE reply_received_at >= now() - interval '24 hours';

CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_latency_p95_singleton ON public.inbound_latency_p95 ((1));
