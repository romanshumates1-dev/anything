-- 017_negotiation_sessions.sql
-- Phase A: per-lead bounded-negotiation sessions. A session exists ONLY after
-- the owner grants the privilege (flag ON + approved range + assignability).
-- Round-trip state is durable here: restart-safe, and each round's outbound is
-- dedupe_key'd (negoffer:{session}:{round}) so a worker restart can never
-- double-send an offer. Idempotent. Rollback: DROP TABLE negotiation_sessions.

CREATE TABLE IF NOT EXISTS public.negotiation_sessions (
  id                    text PRIMARY KEY,
  organization_id       text NOT NULL,
  lead_id               bigint NOT NULL,
  side                  text NOT NULL CHECK (side IN ('seller','buyer')),
  status                text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','agreed','walked_away','paused')),
  round                 integer NOT NULL DEFAULT 0,
  opener_cents          bigint NOT NULL,
  clamp_cents           bigint NOT NULL,   -- seller ceiling / buyer floor
  approved_min_cents    bigint NOT NULL,
  approved_max_cents    bigint NOT NULL,
  last_offer_cents      bigint,
  last_counter_cents    bigint,
  contract_id           text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- One ACTIVE session per lead+side.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_negsession_active
  ON public.negotiation_sessions (lead_id, side) WHERE status = 'active';

COMMENT ON TABLE public.negotiation_sessions IS
  'Phase A bounded negotiation. computeNextOffer (pure) picks every figure; the LLM only wraps prose around an {OFFER} slot; dispatchGate numeric guard blocks any other number.';
