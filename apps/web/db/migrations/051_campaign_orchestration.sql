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
  message_type text NOT NULL CHECK (message_type IN ('initial_offer', 'initial_offer_distress', 'initial_offer_investor', 'follow_up', 'follow_up_adjust', 'follow_up_execution', 'final_check', 'final_close_out', 'final_timing')),

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

-- Seed adaptive message templates with psychological targeting
-- organization_id 'default' = fallback for all orgs
-- Each touch has multiple variants for different seller profiles

INSERT INTO public.campaign_message_library (
  organization_id, touch_number, message_type, subject_template, body_template, variables
) VALUES

-- Touch 1: Initial offer (baseline)
('default', 1, 'initial_offer',
 'Quick question about {address}',
 '<p>Hi {name},</p>
<p>I buy properties as-is in your area. Can offer <strong>{offer}</strong> for {address} and close in 7-14 days.</p>
<p>No repairs, no showings, no hassle. Cash offer, your timeline.</p>
<p>Interested?</p>',
 ARRAY['name', 'address', 'offer']),

-- Touch 1: High distress variant (empathy + speed)
('default', 1, 'initial_offer_distress',
 '{address} — can help quickly',
 '<p>Hi {name},</p>
<p>I understand selling quickly matters. I can close on {address} in as little as 7 days with <strong>{offer}</strong> cash.</p>
<p>No repairs needed, no waiting on financing. I handle everything.</p>
<p>Can we talk today?</p>',
 ARRAY['name', 'address', 'offer']),

-- Touch 1: Investor variant (numbers + certainty)
('default', 1, 'initial_offer_investor',
 'Cash offer for {address}',
 '<p>Hi {name},</p>
<p>Direct offer: <strong>{offer}</strong> for {address}. ARV {arv}, close in 10 days.</p>
<p>All cash, proof of funds attached. No inspection contingency.</p>
<p>Can we finalize this week?</p>',
 ARRAY['name', 'address', 'offer', 'arv']),

-- Touch 2: Day 3 re-engagement (identify motivation)
('default', 2, 'follow_up_adjust',
 'Can adjust terms — {address}',
 '<p>Hi {name},</p>
<p>Still considering offers for {address}?</p>
<p>If {offer} doesn''t work, I can adjust terms. What matters most — price, timeline, or flexibility?</p>',
 ARRAY['name', 'address', 'offer']),

-- Touch 2: Day 3 competitive edge
('default', 2, 'follow_up_execution',
 'Still interested in {address}',
 '<p>{name},</p>
<p>If you''re comparing offers, here''s why sellers choose us: guaranteed close date, no lender delays, we handle all paperwork.</p>
<p>{offer} still stands. Ready when you are.</p>',
 ARRAY['name', 'offer']),

-- Touch 3: Day 5 closing urgency
('default', 3, 'final_close_out',
 'Should I close your file?',
 '<p>Hi {name},</p>
<p>Still interested in {offer} for {address}, or should I close this out?</p>
<p>No pressure — just want to know if you''re still considering.</p>',
 ARRAY['name', 'address', 'offer']),

-- Touch 3: Day 7 timing flexibility
('default', 3, 'final_timing',
 'Timing flexible on {address}',
 '<p>{name},</p>
<p>If timing was the issue, I can be flexible. Close next week or 60 days from now — your call.</p>
<p>{offer} still available. Let me know.</p>',
 ARRAY['name', 'address', 'offer'])

ON CONFLICT DO NOTHING;
