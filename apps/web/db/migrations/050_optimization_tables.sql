-- 050_optimization_tables.sql
-- DealFlow AI Optimization MVP - Core tables
-- Idempotent. Rollback: DROP TABLE lead_events, lead_actions, deal_probabilities, property_valuations, lead_scores;

-- Lead scores (composite + components)
CREATE TABLE IF NOT EXISTS public.lead_scores (
  lead_id bigint PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
  composite_score numeric(3,2) NOT NULL CHECK (composite_score BETWEEN 0 AND 1),
  distress_score numeric(3,2) CHECK (distress_score BETWEEN 0 AND 1),
  recency_score numeric(3,2) CHECK (recency_score BETWEEN 0 AND 1),
  equity_score numeric(3,2) CHECK (equity_score BETWEEN 0 AND 1),
  geo_score numeric(3,2) CHECK (geo_score BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_scores_composite ON public.lead_scores(composite_score DESC);

COMMENT ON TABLE public.lead_scores IS 'Lead quality scoring for optimization pipeline';

-- Property valuations (ARV + repairs + offer range)
CREATE TABLE IF NOT EXISTS public.property_valuations (
  lead_id bigint PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
  arv integer NOT NULL CHECK (arv > 0),
  arv_confidence numeric(3,2) NOT NULL CHECK (arv_confidence BETWEEN 0 AND 1),
  repairs integer NOT NULL CHECK (repairs >= 0),
  offer_min integer NOT NULL CHECK (offer_min > 0),
  offer_max integer NOT NULL CHECK (offer_max > 0),
  comps_count integer DEFAULT 0 CHECK (comps_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_property_valuations_confidence ON public.property_valuations(arv_confidence DESC);

COMMENT ON TABLE public.property_valuations IS 'Property valuation outputs from valuation agent';

-- Deal probabilities (P(close) + expected value)
CREATE TABLE IF NOT EXISTS public.deal_probabilities (
  lead_id bigint PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
  p_close numeric(5,4) NOT NULL CHECK (p_close BETWEEN 0 AND 1),
  expected_value integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deal_probabilities_ev ON public.deal_probabilities(expected_value DESC);

COMMENT ON TABLE public.deal_probabilities IS 'Deal probability and expected value calculations';

-- Lead actions (priority queue)
CREATE TABLE IF NOT EXISTS public.lead_actions (
  id bigserial PRIMARY KEY,
  lead_id bigint NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  action text NOT NULL,
  priority numeric NOT NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'executing', 'completed', 'failed')),
  reason jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_lead_actions_priority ON public.lead_actions(priority DESC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_lead_actions_lead ON public.lead_actions(lead_id);

COMMENT ON TABLE public.lead_actions IS 'Action queue prioritized by expected value';

-- Lead events (ground truth for learning)
CREATE TABLE IF NOT EXISTS public.lead_events (
  id bigserial PRIMARY KEY,
  lead_id bigint NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_data jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_events_lead ON public.lead_events(lead_id, created_at);
CREATE INDEX IF NOT EXISTS idx_lead_events_type ON public.lead_events(event_type, created_at);

COMMENT ON TABLE public.lead_events IS 'Event log for outcome tracking and learning';
