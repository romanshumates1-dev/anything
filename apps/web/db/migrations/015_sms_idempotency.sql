-- 015_sms_idempotency.sql — durable SMS send idempotency (Gap G-3).
--
-- The gateway's in-memory Map idempotency does not survive a restart and is not
-- shared across instances/workers. This table makes the dedup durable: a send's
-- message_uuid is remembered here after a successful dispatch, so a retry (or a
-- second worker) that sees the same uuid returns the recorded result instead of
-- dispatching again. Keyed only by message_uuid so it is universal (unlike
-- message_events, which requires org/campaign context).

CREATE TABLE IF NOT EXISTS public.sms_idempotency (
  message_uuid text PRIMARY KEY,
  status text NOT NULL,
  provider_id text,
  provider text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Sweep old rows by age (a periodic job deletes created_at < now() - retention).
CREATE INDEX IF NOT EXISTS idx_sms_idempotency_created ON public.sms_idempotency(created_at);
