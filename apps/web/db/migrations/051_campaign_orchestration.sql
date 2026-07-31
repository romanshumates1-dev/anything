-- 051_campaign_orchestration.sql
-- Campaign orchestration layer - connects optimization pipeline to rate-limited outreach
-- Idempotent. Rollback: DROP TABLE campaign_outcomes, campaign_message_library, campaign_lead_queue;

-- Links optimization pipeline leads to outreach campaigns
CREATE TABLE IF NOT EXISTS public.campaign_lead_queue (
  id bigserial PRIMARY KEY,
  organization_id text NOT NULL,
  campaign_id text REFERENCES public.outreach_campaigns(id) ON DELETE CASCADE,
  lead_id bigint NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,

  -- From optimization pipeline
  expected_value integer NOT NULL,  -- cents
  p_close numeric(5,4) NOT NULL CHECK (p_close BETWEEN 0 AND 1),
  offer_min integer NOT NULL CHECK (offer_min > 0),
  offer_max integer NOT NULL CHECK (offer_max >= offer_min),

  -- Outreach state
  touch_number integer NOT NULL DEFAULT 0 CHECK (touch_number >= 0 AND touch_number <= 3),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'replied', 'interested', 'rejected', 'dead')),

  -- Timing
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  last_sent_at timestamptz,
  last_reply_at timestamptz,

  -- Response classification (manual or AI-assisted)
  reply_sentiment text CHECK (reply_sentiment IN ('positive', 'neutral', 'negative', 'objection', 'question')),
  requires_manual_review boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_queue_org ON public.campaign_lead_queue(organization_id);
CREATE INDEX IF NOT EXISTS idx_campaign_queue_lead ON public.campaign_lead_queue(lead_id);
CREATE INDEX IF NOT EXISTS idx_campaign_queue_scheduled ON public.campaign_lead_queue(scheduled_for)
  WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_campaign_queue_review ON public.campaign_lead_queue(expected_value DESC)
  WHERE requires_manual_review = true;
CREATE INDEX IF NOT EXISTS idx_campaign_queue_status ON public.campaign_lead_queue(status, updated_at);

COMMENT ON TABLE public.campaign_lead_queue IS 'Campaign orchestration: optimization pipeline -> rate-limited outreach';

-- Message templates with personalization
CREATE TABLE IF NOT EXISTS public.campaign_message_library (
  id bigserial PRIMARY KEY,
  organization_id text NOT NULL,
  touch_number integer NOT NULL CHECK (touch_number BETWEEN 1 AND 3),
  message_type text NOT NULL CHECK (message_type IN ('initial_offer', 'follow_up', 'final_check')),

  subject_template text NOT NULL,
  body_template text NOT NULL,

  -- Personalization variables: {name}, {address}, {offer}, {arv}, {closing_days}
  variables text[] DEFAULT ARRAY['name', 'address', 'offer'],

  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_library_org_touch ON public.campaign_message_library(organization_id, touch_number)
  WHERE active = true;

COMMENT ON TABLE public.campaign_message_library IS 'Email templates with personalization variables';

-- Track outcomes for learning
CREATE TABLE IF NOT EXISTS public.campaign_outcomes (
  id bigserial PRIMARY KEY,
  campaign_lead_id bigint NOT NULL REFERENCES public.campaign_lead_queue(id) ON DELETE CASCADE,
  lead_id bigint NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  organization_id text NOT NULL,

  -- What happened
  outcome_type text NOT NULL CHECK (outcome_type IN ('contract', 'verbal_yes', 'counter_offer', 'not_interested', 'no_response')),
  touches_to_outcome integer,
  days_to_outcome numeric,

  -- Deal details (if closed)
  offer_accepted integer CHECK (offer_accepted > 0),
  actual_fee integer CHECK (actual_fee >= 0),

  -- Learning data
  predicted_p_close numeric(5,4),
  actual_closed boolean NOT NULL,

  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_outcomes_lead ON public.campaign_outcomes(lead_id);
CREATE INDEX IF NOT EXISTS idx_campaign_outcomes_org ON public.campaign_outcomes(organization_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_outcomes_recorded ON public.campaign_outcomes(recorded_at DESC);

COMMENT ON TABLE public.campaign_outcomes IS 'Outcome tracking for probability model calibration';

-- Seed default message templates (organization_id 'default' = fallback for all orgs)
INSERT INTO public.campaign_message_library (
  organization_id, touch_number, message_type, subject_template, body_template, variables
) VALUES

-- Touch 1: Initial offer
('default', 1, 'initial_offer',
 'Quick question about {address}',
 '<p>Hi {name},</p>
<p>I came across {address} and wanted to reach out with a straightforward offer.</p>
<p>Based on current market comps and the work the property needs, I can offer <strong>{offer}</strong> and close in 7-14 days.</p>
<p>We buy as-is - no repairs, no showings, no contingencies. Just a clean, fast close.</p>
<p>Would that work for you?</p>
<p>Best,<br>Your Name</p>',
 ARRAY['name', 'address', 'offer']),

-- Touch 2: Follow-up (2 days later)
('default', 2, 'follow_up',
 'Following up on {address}',
 '<p>Hi {name},</p>
<p>Just wanted to follow up on my offer for {address}.</p>
<p>I know these decisions take time. If you have any questions about the offer or process, I''m happy to hop on a quick call.</p>
<p>The offer of <strong>{offer}</strong> stands and we can close whenever works for you.</p>
<p>Best,<br>Your Name</p>',
 ARRAY['name', 'address', 'offer']),

-- Touch 3: Final check (5 days later)
('default', 3, 'final_check',
 'Last check-in on {address}',
 '<p>Hi {name},</p>
<p>I wanted to reach out one last time about {address} before I move on to other opportunities.</p>
<p>My offer of <strong>{offer}</strong> is still available if you decide selling makes sense.</p>
<p>If now isn''t the right time, no problem at all. Just wanted to make sure you had a chance to consider it.</p>
<p>Best of luck either way,<br>Your Name</p>',
 ARRAY['name', 'address', 'offer'])

ON CONFLICT DO NOTHING;
