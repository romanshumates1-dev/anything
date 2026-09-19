-- 077_campaign_automation_engine.sql
-- Campaign Automation Engine - enables "set and forget" campaign operation
-- Adds: campaign_settings, automation_rules, campaign_automation_state
-- Idempotent. Rollback: DROP TABLE campaign_automation_state, campaign_automation_rules, campaign_settings;

-- Automation level enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'automation_level') THEN
    CREATE TYPE automation_level AS ENUM ('manual', 'semi_auto', 'full_auto');
  END IF;
END $$;

-- Lead routing action enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lead_routing_action') THEN
    CREATE TYPE lead_routing_action AS ENUM (
      'assign_campaign',
      'schedule_touch',
      'move_to_negotiation',
      'escalate_human',
      'mark_cold',
      'mark_unresponsive'
    );
  END IF;
END $$;

-- Campaign settings - user-configurable per campaign
CREATE TABLE IF NOT EXISTS public.campaign_settings (
  id text PRIMARY KEY,
  campaign_id text NOT NULL REFERENCES public.outreach_campaigns(id) ON DELETE CASCADE,
  organization_id text NOT NULL,

  -- Regional targeting
  target_regions jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{type: 'zip'|'county'|'state', value: '...'}]
  target_property_types text[] DEFAULT ARRAY['single_family', 'multi_family', 'condo'],
  target_price_min integer,  -- cents
  target_price_max integer,  -- cents

  -- Send timing
  send_window_start time NOT NULL DEFAULT '09:00',  -- local time
  send_window_end time NOT NULL DEFAULT '17:00',
  send_days text[] NOT NULL DEFAULT ARRAY['mon', 'tue', 'wed', 'thu', 'fri'],
  touch_delays integer[] NOT NULL DEFAULT ARRAY[0, 2, 5, 10],  -- days between touches

  -- Automation levels
  automation_level automation_level NOT NULL DEFAULT 'semi_auto',
  auto_send_enabled boolean NOT NULL DEFAULT false,
  auto_negotiate_enabled boolean NOT NULL DEFAULT false,
  auto_contract_enabled boolean NOT NULL DEFAULT false,

  -- Thresholds
  human_review_threshold integer DEFAULT 10000000,  -- cents ($100k) - escalate deals over this
  max_auto_counters integer NOT NULL DEFAULT 3,  -- max AI counter-offers before escalate
  response_timeout_hours integer NOT NULL DEFAULT 72,  -- hours before marking unresponsive
  max_touches integer NOT NULL DEFAULT 4,  -- max outreach attempts

  -- AI settings
  ai_tone text DEFAULT 'professional',  -- professional, casual, urgent, empathetic
  ai_personalization_level text DEFAULT 'high',  -- low, medium, high
  ab_testing_enabled boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_campaign_settings_campaign ON public.campaign_settings(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_settings_org ON public.campaign_settings(organization_id);

COMMENT ON TABLE public.campaign_settings IS 'User-configurable campaign automation settings';

-- Automation rules - defines state machine transitions
CREATE TABLE IF NOT EXISTS public.campaign_automation_rules (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  campaign_id text REFERENCES public.outreach_campaigns(id) ON DELETE CASCADE,  -- NULL = org default

  -- Trigger
  trigger_event text NOT NULL,  -- 'lead_imported', 'touch_sent', 'response_received', 'no_response_timeout', 'negotiation_started'
  trigger_conditions jsonb DEFAULT '{}'::jsonb,  -- Optional conditions like {response_type: 'interested'}

  -- Action
  action lead_routing_action NOT NULL,
  action_params jsonb DEFAULT '{}'::jsonb,  -- Action-specific params

  -- Priority & execution
  priority integer NOT NULL DEFAULT 100,  -- lower = higher priority
  is_active boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automation_rules_org ON public.campaign_automation_rules(organization_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_automation_rules_campaign ON public.campaign_automation_rules(campaign_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_automation_rules_trigger ON public.campaign_automation_rules(trigger_event) WHERE is_active = true;

COMMENT ON TABLE public.campaign_automation_rules IS 'Configurable automation rules for campaign state machine';

-- Campaign automation state - tracks per-contact automation state
CREATE TABLE IF NOT EXISTS public.campaign_automation_state (
  id text PRIMARY KEY,
  campaign_id text NOT NULL REFERENCES public.outreach_campaigns(id) ON DELETE CASCADE,
  contact_id text NOT NULL REFERENCES public.campaign_contacts(id) ON DELETE CASCADE,
  organization_id text NOT NULL,

  -- Current state
  current_touch integer NOT NULL DEFAULT 0,
  next_touch_scheduled_at timestamptz,
  last_touch_at timestamptz,
  last_response_at timestamptz,

  -- AI classification
  response_classification text,  -- 'interested', 'not_interested', 'counter_offer', 'question', 'objection'
  interest_score numeric(3,2),  -- 0.00 to 1.00
  negotiation_stage text,  -- 'initial', 'countering', 'agreed', 'walked_away'
  counter_offer_count integer NOT NULL DEFAULT 0,

  -- Routing
  routed_to_negotiation boolean NOT NULL DEFAULT false,
  routed_to_human boolean NOT NULL DEFAULT false,
  human_escalation_reason text,

  -- Outcome tracking
  outcome text,  -- 'contract', 'no_deal', 'unresponsive', 'opted_out'
  outcome_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_campaign_automation_contact ON public.campaign_automation_state(campaign_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_automation_state_org ON public.campaign_automation_state(organization_id);
CREATE INDEX IF NOT EXISTS idx_automation_state_next_touch ON public.campaign_automation_state(next_touch_scheduled_at)
  WHERE next_touch_scheduled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_automation_state_needs_human ON public.campaign_automation_state(organization_id)
  WHERE routed_to_human = true AND outcome IS NULL;

COMMENT ON TABLE public.campaign_automation_state IS 'Per-contact automation state for campaign engine';

-- Response classifications for AI categorization
CREATE TABLE IF NOT EXISTS public.response_classifications (
  id text PRIMARY KEY,
  contact_id text NOT NULL REFERENCES public.campaign_contacts(id) ON DELETE CASCADE,
  message_id text,  -- Reference to the message being classified
  organization_id text NOT NULL,

  -- Classification result
  classification text NOT NULL,  -- 'interested', 'not_interested', 'counter_offer', 'question', 'objection', 'spam'
  confidence numeric(3,2) NOT NULL,

  -- Extracted data
  extracted_price integer,  -- cents, if counter-offer detected
  extracted_timeline text,  -- 'immediate', 'soon', 'later', 'unknown'
  extracted_objections text[],  -- ['price_too_low', 'bad_timing', 'not_selling']

  -- AI metadata
  model_used text,
  raw_response jsonb,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_response_class_contact ON public.response_classifications(contact_id);
CREATE INDEX IF NOT EXISTS idx_response_class_org ON public.response_classifications(organization_id, created_at DESC);

COMMENT ON TABLE public.response_classifications IS 'AI-generated response classifications for automation routing';

-- Campaign automation metrics (aggregated for dashboard)
CREATE TABLE IF NOT EXISTS public.campaign_automation_metrics (
  id text PRIMARY KEY,
  campaign_id text NOT NULL REFERENCES public.outreach_campaigns(id) ON DELETE CASCADE,
  organization_id text NOT NULL,
  metric_date date NOT NULL,

  -- Volume metrics
  leads_processed integer NOT NULL DEFAULT 0,
  messages_sent integer NOT NULL DEFAULT 0,
  responses_received integer NOT NULL DEFAULT 0,

  -- Response breakdown
  interested_count integer NOT NULL DEFAULT 0,
  not_interested_count integer NOT NULL DEFAULT 0,
  counter_offer_count integer NOT NULL DEFAULT 0,
  no_response_count integer NOT NULL DEFAULT 0,

  -- Conversion metrics
  negotiations_started integer NOT NULL DEFAULT 0,
  contracts_sent integer NOT NULL DEFAULT 0,
  contracts_signed integer NOT NULL DEFAULT 0,

  -- Human escalation
  human_escalations integer NOT NULL DEFAULT 0,

  -- Performance
  avg_response_time_hours numeric(10,2),
  avg_touches_to_response numeric(5,2),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_automation_metrics_campaign_date ON public.campaign_automation_metrics(campaign_id, metric_date);
CREATE INDEX IF NOT EXISTS idx_automation_metrics_org ON public.campaign_automation_metrics(organization_id, metric_date DESC);

COMMENT ON TABLE public.campaign_automation_metrics IS 'Daily campaign automation metrics for dashboards';

-- Seed default automation rules (per organization, applied if no campaign-specific rules)
INSERT INTO public.campaign_automation_rules (id, organization_id, campaign_id, trigger_event, trigger_conditions, action, action_params, priority)
VALUES
-- Lead imported -> assign to active campaign
('rule_default_lead_assign', 'default', NULL, 'lead_imported', '{}'::jsonb, 'assign_campaign', '{"strategy": "round_robin"}'::jsonb, 10),

-- First touch sent -> schedule follow-up
('rule_default_followup_1', 'default', NULL, 'touch_sent', '{"touch_number": 1}'::jsonb, 'schedule_touch', '{"delay_days": 2}'::jsonb, 20),
('rule_default_followup_2', 'default', NULL, 'touch_sent', '{"touch_number": 2}'::jsonb, 'schedule_touch', '{"delay_days": 5}'::jsonb, 21),
('rule_default_followup_3', 'default', NULL, 'touch_sent', '{"touch_number": 3}'::jsonb, 'schedule_touch', '{"delay_days": 10}'::jsonb, 22),

-- Response received: interested -> negotiation
('rule_default_interested', 'default', NULL, 'response_received', '{"classification": "interested"}'::jsonb, 'move_to_negotiation', '{}'::jsonb, 30),

-- Response received: counter-offer -> negotiation
('rule_default_counter', 'default', NULL, 'response_received', '{"classification": "counter_offer"}'::jsonb, 'move_to_negotiation', '{"with_counter": true}'::jsonb, 31),

-- Response received: not interested -> mark cold
('rule_default_not_interested', 'default', NULL, 'response_received', '{"classification": "not_interested"}'::jsonb, 'mark_cold', '{}'::jsonb, 32),

-- No response after max touches -> mark unresponsive
('rule_default_unresponsive', 'default', NULL, 'no_response_timeout', '{}'::jsonb, 'mark_unresponsive', '{}'::jsonb, 40)

ON CONFLICT (id) DO UPDATE SET
  trigger_event = EXCLUDED.trigger_event,
  trigger_conditions = EXCLUDED.trigger_conditions,
  action = EXCLUDED.action,
  action_params = EXCLUDED.action_params,
  priority = EXCLUDED.priority,
  updated_at = now();

-- Add automation columns to outreach_campaigns if not exists
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'outreach_campaigns' AND column_name = 'automation_enabled') THEN
    ALTER TABLE public.outreach_campaigns ADD COLUMN automation_enabled boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'outreach_campaigns' AND column_name = 'last_automation_run') THEN
    ALTER TABLE public.outreach_campaigns ADD COLUMN last_automation_run timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'outreach_campaigns' AND column_name = 'automation_paused_reason') THEN
    ALTER TABLE public.outreach_campaigns ADD COLUMN automation_paused_reason text;
  END IF;
END $$;

-- Add email column to campaign_contacts if not exists
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'campaign_contacts' AND column_name = 'email') THEN
    ALTER TABLE public.campaign_contacts ADD COLUMN email text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'campaign_contacts' AND column_name = 'property_address') THEN
    ALTER TABLE public.campaign_contacts ADD COLUMN property_address text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'campaign_contacts' AND column_name = 'property_type') THEN
    ALTER TABLE public.campaign_contacts ADD COLUMN property_type text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'campaign_contacts' AND column_name = 'estimated_value') THEN
    ALTER TABLE public.campaign_contacts ADD COLUMN estimated_value integer;  -- cents
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'campaign_contacts' AND column_name = 'region') THEN
    ALTER TABLE public.campaign_contacts ADD COLUMN region jsonb;  -- {zip, county, state}
  END IF;
END $$;
