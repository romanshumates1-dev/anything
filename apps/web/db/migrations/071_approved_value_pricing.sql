-- ============================================================================
-- Migration 071 — User-approved value-based pricing with 92-97% margins
--
-- AWS Pricing (verified 2026-08):
--   SMS: $0.015/msg (AWS SNS 10DLC with carrier fees)
--   Email: $0.0001/msg (AWS SES at $0.10/1000)
--   AI: $0.004/credit avg (Claude Haiku 4.5 at $1/1M input, $5/1M output)
--
-- APPROVED TIERS:
--   Free:     $0/mo     - 25 emails, 5 AI credits (trial)
--   Starter:  $99/mo    - 100 SMS, 500 AI credits  | 97% margin
--   Pro:      $299/mo   - 500 SMS, 2,500 AI credits | 96% margin
--   Business: $699/mo   - 1,500 SMS, 10,000 AI credits | 94% margin
--   Scale:    $1,799/mo - 5,000 SMS, 35,000 AI credits | 92% margin
--
-- CREDIT PACKS:
--   SMS: $99/1K (85%), $449/5K (83%), $999/15K (77%), $2,499/50K (70%)
--   AI:  $29/500 (97%), $99/2.5K (95%), $299/10K (93%), $1,199/50K (92%)
-- ============================================================================

BEGIN;

-- Starter: $99/mo - Entry tier for new wholesalers (97% margin)
UPDATE public.subscription_plans
SET price_cents = 9900,
    limits = jsonb_set(
      jsonb_set(
        jsonb_set(limits, '{monthly_sms_allowance}', '100'),
        '{monthly_ai_credits}', '500'
      ),
      '{margin_percent}', '97'
    ),
    updated_at = now()
WHERE id = 'plan_starter';

-- Pro: $299/mo - Active wholesalers (96% margin)
UPDATE public.subscription_plans
SET price_cents = 29900,
    limits = jsonb_set(
      jsonb_set(
        jsonb_set(limits, '{monthly_sms_allowance}', '500'),
        '{monthly_ai_credits}', '2500'
      ),
      '{margin_percent}', '96'
    ),
    updated_at = now()
WHERE id = 'plan_pro';

-- Business: $699/mo - Scaling wholesalers (94% margin)
UPDATE public.subscription_plans
SET price_cents = 69900,
    limits = jsonb_set(
      jsonb_set(
        jsonb_set(limits, '{monthly_sms_allowance}', '1500'),
        '{monthly_ai_credits}', '10000'
      ),
      '{margin_percent}', '94'
    ),
    updated_at = now()
WHERE id = 'plan_business';

-- Scale: $1,799/mo - High-volume operations (92% margin)
UPDATE public.subscription_plans
SET price_cents = 179900,
    limits = jsonb_set(
      jsonb_set(
        jsonb_set(limits, '{monthly_sms_allowance}', '5000'),
        '{monthly_ai_credits}', '35000'
      ),
      '{margin_percent}', '92'
    ),
    updated_at = now()
WHERE id = 'plan_scale';

-- ============================================================================
-- Credit Packs Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.credit_packs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('sms', 'ai', 'email')),
  name TEXT NOT NULL,
  credits INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  margin_percent INTEGER NOT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- SMS Packs
INSERT INTO public.credit_packs (id, type, name, credits, price_cents, margin_percent) VALUES
('sms_pack_1k', 'sms', '1,000 SMS Credits', 1000, 9900, 85),
('sms_pack_5k', 'sms', '5,000 SMS Credits', 5000, 44900, 83),
('sms_pack_15k', 'sms', '15,000 SMS Credits', 15000, 99900, 77),
('sms_pack_50k', 'sms', '50,000 SMS Credits', 50000, 249900, 70)
ON CONFLICT (id) DO UPDATE SET
  credits = EXCLUDED.credits,
  price_cents = EXCLUDED.price_cents,
  margin_percent = EXCLUDED.margin_percent,
  updated_at = now();

-- AI Credit Packs
INSERT INTO public.credit_packs (id, type, name, credits, price_cents, margin_percent) VALUES
('ai_pack_500', 'ai', '500 AI Credits', 500, 2900, 97),
('ai_pack_2500', 'ai', '2,500 AI Credits', 2500, 9900, 95),
('ai_pack_10k', 'ai', '10,000 AI Credits', 10000, 29900, 93),
('ai_pack_50k', 'ai', '50,000 AI Credits', 50000, 119900, 92)
ON CONFLICT (id) DO UPDATE SET
  credits = EXCLUDED.credits,
  price_cents = EXCLUDED.price_cents,
  margin_percent = EXCLUDED.margin_percent,
  updated_at = now();

COMMIT;
