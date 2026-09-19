-- 072_ai_template_library.sql
-- AI-powered campaign template library for intuitive campaign creation
-- Supports: AI-generated templates, user-saved templates, pre-made library templates
-- Idempotent. Rollback: DROP TABLE user_templates, template_library, ai_template_generations;

-- Template category enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'template_category') THEN
    CREATE TYPE template_category AS ENUM (
      'cold_outreach',
      'follow_up',
      'closing',
      'reengagement',
      'buyer_outreach',
      'custom'
    );
  END IF;
END $$;

-- Template channel enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'template_channel') THEN
    CREATE TYPE template_channel AS ENUM ('sms', 'email', 'both');
  END IF;
END $$;

-- Pre-made template library (system-wide, read-only for users)
CREATE TABLE IF NOT EXISTS public.template_library (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  category template_category NOT NULL DEFAULT 'cold_outreach',
  channel template_channel NOT NULL DEFAULT 'sms',

  -- Template content
  subject text,                    -- For email templates
  body text NOT NULL,

  -- Sequence templates (for multi-touch campaigns)
  follow_up_1 text,
  follow_up_1_delay_hours integer DEFAULT 24,
  follow_up_2 text,
  follow_up_2_delay_hours integer DEFAULT 48,
  follow_up_3 text,
  follow_up_3_delay_hours integer DEFAULT 72,

  -- Metadata
  variables text[] NOT NULL DEFAULT ARRAY['{{firstName}}', '{{propertyAddress}}'],
  tags text[] DEFAULT '{}',
  use_count integer NOT NULL DEFAULT 0,
  avg_response_rate numeric(5,2),

  -- Display
  is_featured boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_template_library_category ON public.template_library(category) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_template_library_featured ON public.template_library(is_featured, sort_order) WHERE is_active = true;

COMMENT ON TABLE public.template_library IS 'Pre-made campaign templates curated by DealFlow';

-- User-saved templates (per organization)
CREATE TABLE IF NOT EXISTS public.user_templates (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  created_by text NOT NULL,

  name text NOT NULL,
  description text,
  category template_category NOT NULL DEFAULT 'custom',
  channel template_channel NOT NULL DEFAULT 'sms',

  -- Template content
  subject text,
  body text NOT NULL,

  -- Sequence templates
  follow_up_1 text,
  follow_up_1_delay_hours integer DEFAULT 24,
  follow_up_2 text,
  follow_up_2_delay_hours integer DEFAULT 48,
  follow_up_3 text,
  follow_up_3_delay_hours integer DEFAULT 72,

  -- Metadata
  variables text[] NOT NULL DEFAULT ARRAY['{{firstName}}', '{{propertyAddress}}'],
  tags text[] DEFAULT '{}',
  use_count integer NOT NULL DEFAULT 0,

  -- Source tracking (if created from AI or library)
  source_type text CHECK (source_type IN ('manual', 'ai_generated', 'library_copy')),
  source_id text,

  is_favorite boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_templates_org ON public.user_templates(organization_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_user_templates_org_category ON public.user_templates(organization_id, category) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_user_templates_org_favorite ON public.user_templates(organization_id, is_favorite) WHERE is_active = true;

COMMENT ON TABLE public.user_templates IS 'User-created and saved campaign templates';

-- AI template generation history (for learning and regeneration)
CREATE TABLE IF NOT EXISTS public.ai_template_generations (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  user_id text NOT NULL,

  -- Input
  prompt text NOT NULL,
  campaign_goal text,
  target_audience text,
  tone text,
  channel template_channel NOT NULL DEFAULT 'sms',

  -- Output
  generated_subject text,
  generated_body text NOT NULL,
  generated_follow_ups jsonb DEFAULT '[]'::jsonb,
  variables_used text[] DEFAULT '{}',

  -- Quality metrics
  was_used boolean NOT NULL DEFAULT false,
  was_edited boolean NOT NULL DEFAULT false,
  user_rating integer CHECK (user_rating BETWEEN 1 AND 5),
  feedback text,

  -- AI metadata
  model_used text,
  tokens_used integer,
  generation_time_ms integer,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_template_gen_org ON public.ai_template_generations(organization_id);
CREATE INDEX IF NOT EXISTS idx_ai_template_gen_user ON public.ai_template_generations(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_template_gen_created ON public.ai_template_generations(created_at DESC);

COMMENT ON TABLE public.ai_template_generations IS 'History of AI-generated templates for learning and analytics';

-- Seed pre-made template library with high-converting templates
INSERT INTO public.template_library (id, name, description, category, channel, body, follow_up_1, follow_up_1_delay_hours, follow_up_2, follow_up_2_delay_hours, variables, tags, is_featured, sort_order)
VALUES
-- Cold Outreach Templates
('tpl_cold_friendly_01', 'Friendly Introduction', 'Warm, conversational opener that builds rapport', 'cold_outreach', 'sms',
 'Hi {{firstName}}, I came across {{propertyAddress}} and wanted to reach out. Would you consider an offer on it? No pressure at all - just curious if you''d entertain a quick sale.',
 'Hey {{firstName}}, just following up on my message about {{propertyAddress}}. Any interest in chatting about it?',
 24,
 '{{firstName}}, I know you''re probably busy! Just wanted to make sure my message didn''t get lost. Would love to chat when you have a moment.',
 48,
 ARRAY['{{firstName}}', '{{propertyAddress}}', '{{city}}'],
 ARRAY['high-converting', 'friendly', 'residential'],
 true, 1),

('tpl_cold_direct_01', 'Direct Cash Offer', 'Straight-to-the-point cash buyer approach', 'cold_outreach', 'sms',
 'Hi {{firstName}}, I''m a local investor looking to buy properties in {{city}}. I can make a fair cash offer on {{propertyAddress}} with a quick close. Would you be open to a conversation?',
 '{{firstName}}, just checking in - any thoughts on my cash offer inquiry for {{propertyAddress}}?',
 24,
 'Last follow-up: I can close in as little as 2 weeks on {{propertyAddress}}. Let me know if timing works for you.',
 72,
 ARRAY['{{firstName}}', '{{propertyAddress}}', '{{city}}'],
 ARRAY['direct', 'cash-offer', 'fast-close'],
 true, 2),

('tpl_cold_helpful_01', 'Problem Solver', 'Positions you as someone who helps with property challenges', 'cold_outreach', 'sms',
 'Hi {{firstName}}, I help homeowners in {{city}} who need flexible solutions for their properties. If {{propertyAddress}} is something you''ve been thinking about selling - even if it needs work - I''d love to chat about options.',
 '{{firstName}}, following up on {{propertyAddress}}. Whether it''s timing, repairs, or just exploring options - I''m here to help.',
 24,
 'Hey {{firstName}}, no pressure at all. If you ever want to discuss {{propertyAddress}}, I''m just a text away.',
 72,
 ARRAY['{{firstName}}', '{{propertyAddress}}', '{{city}}'],
 ARRAY['helpful', 'flexible', 'distressed'],
 true, 3),

-- Follow-up Templates
('tpl_followup_value_01', 'Value Reminder', 'Reminds prospect of the value you offer', 'follow_up', 'sms',
 'Hi {{firstName}}, just wanted to circle back on {{propertyAddress}}. We handle all the paperwork, cover closing costs, and can work around your timeline. Any questions I can answer?',
 NULL, NULL, NULL, NULL,
 ARRAY['{{firstName}}', '{{propertyAddress}}'],
 ARRAY['value-add', 'benefits'],
 false, 10),

('tpl_followup_timing_01', 'Timing Check', 'Perfect for leads who went cold', 'follow_up', 'sms',
 '{{firstName}}, I know selling isn''t always top of mind. Just wanted to check if now or later might be a better time to discuss {{propertyAddress}}. Happy to connect whenever works.',
 NULL, NULL, NULL, NULL,
 ARRAY['{{firstName}}', '{{propertyAddress}}'],
 ARRAY['soft-follow', 'timing'],
 false, 11),

-- Closing Templates
('tpl_closing_urgency_01', 'Soft Urgency', 'Creates gentle urgency without pressure', 'closing', 'sms',
 'Hi {{firstName}}, I''ve got some room in my schedule to close quickly on {{propertyAddress}} this month. If you''re ready to move forward, let me know - I can get you an offer within 24 hours.',
 NULL, NULL, NULL, NULL,
 ARRAY['{{firstName}}', '{{propertyAddress}}'],
 ARRAY['closing', 'urgency', 'fast-offer'],
 true, 20),

('tpl_closing_final_01', 'Final Touchpoint', 'Last attempt before archiving', 'closing', 'sms',
 '{{firstName}}, this will be my last message about {{propertyAddress}}. If you ever change your mind, feel free to reach out. Wishing you all the best!',
 NULL, NULL, NULL, NULL,
 ARRAY['{{firstName}}', '{{propertyAddress}}'],
 ARRAY['final', 'polite-close'],
 false, 21),

-- Re-engagement Templates
('tpl_reengagement_check_01', 'Situation Check', '30/60/90 day re-engagement', 'reengagement', 'sms',
 'Hi {{firstName}}, it''s been a while since we chatted about {{propertyAddress}}. Just checking in - has your situation changed at all? I''m still interested if you are.',
 '{{firstName}}, hope all is well! Let me know if {{propertyAddress}} is something you''d reconsider.',
 72,
 NULL, NULL,
 ARRAY['{{firstName}}', '{{propertyAddress}}'],
 ARRAY['reengagement', 'resurrection'],
 true, 30),

-- Buyer Campaign Templates
('tpl_buyer_intro_01', 'Buyer Introduction', 'Initial outreach to cash buyers', 'buyer_outreach', 'sms',
 'Hi {{firstName}}, I have a property coming available in {{city}} that might fit your buy box. It''s a {{propertyType}} at {{propertyAddress}}. Interested in details?',
 '{{firstName}}, following up on the {{propertyType}} in {{city}}. Great opportunity - let me know if you want the numbers.',
 24,
 NULL, NULL,
 ARRAY['{{firstName}}', '{{propertyAddress}}', '{{city}}', '{{propertyType}}'],
 ARRAY['buyers', 'deal-flow'],
 true, 40)

ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  body = EXCLUDED.body,
  follow_up_1 = EXCLUDED.follow_up_1,
  follow_up_1_delay_hours = EXCLUDED.follow_up_1_delay_hours,
  follow_up_2 = EXCLUDED.follow_up_2,
  follow_up_2_delay_hours = EXCLUDED.follow_up_2_delay_hours,
  variables = EXCLUDED.variables,
  tags = EXCLUDED.tags,
  is_featured = EXCLUDED.is_featured,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();
