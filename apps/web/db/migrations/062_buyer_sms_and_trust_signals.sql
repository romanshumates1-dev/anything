-- Migration 062: Buyer SMS Notifications + Trust Signals
-- Adds beta flag for buyer SMS notifications
-- Adds trust signal configuration table for contract flow

-- Note: Beta flags are stored in app_settings table as JSONB under key 'beta_flags'
-- The buyerSmsNotify flag is added via the betaFlags.ts utility when first accessed

-- Trust signals configuration for contract flow
-- These are displayed to sellers during the offer-to-signature process
CREATE TABLE IF NOT EXISTS trust_signals (
  id SERIAL PRIMARY KEY,
  organization_id TEXT NOT NULL,
  signal_type TEXT NOT NULL CHECK (signal_type IN (
    'deal_count',        -- "We've closed X deals in your area"
    'rating',            -- "4.9 star rating from 100+ sellers"
    'time_to_close',     -- "Average closing time: 14 days"
    'cash_buyer',        -- "No financing contingencies"
    'local_presence',    -- "Local office at [address]"
    'testimonial',       -- Featured seller testimonial
    'bbb_accredited',    -- BBB accreditation badge
    'license_info',      -- "Licensed in [state] - #12345"
    'years_in_business', -- "Serving [area] since 2018"
    'guarantee'          -- "No-obligation, free home evaluation"
  )),
  content JSONB NOT NULL DEFAULT '{}',
  -- content structure depends on signal_type:
  -- deal_count: {count: number, area: string, timeframe: string}
  -- rating: {stars: number, count: number, source: string}
  -- testimonial: {name: string, quote: string, property_type: string}
  -- license_info: {state: string, license_number: string}
  display_order INTEGER DEFAULT 0,
  show_in_email BOOLEAN DEFAULT true,
  show_in_sms BOOLEAN DEFAULT true,
  show_in_contract BOOLEAN DEFAULT true,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trust_signals_org_active
  ON trust_signals(organization_id, active, display_order);

-- Seed default trust signals
INSERT INTO trust_signals (organization_id, signal_type, content, display_order, active)
SELECT 'default', 'cash_buyer', '{"message": "100% cash offer - no banks, no financing delays"}'::jsonb, 1, true
WHERE NOT EXISTS (SELECT 1 FROM trust_signals WHERE organization_id = 'default' AND signal_type = 'cash_buyer');

INSERT INTO trust_signals (organization_id, signal_type, content, display_order, active)
SELECT 'default', 'time_to_close', '{"days": 14, "message": "Close in as few as 14 days"}'::jsonb, 2, true
WHERE NOT EXISTS (SELECT 1 FROM trust_signals WHERE organization_id = 'default' AND signal_type = 'time_to_close');

INSERT INTO trust_signals (organization_id, signal_type, content, display_order, active)
SELECT 'default', 'guarantee', '{"message": "No fees, no commissions, no obligation"}'::jsonb, 3, true
WHERE NOT EXISTS (SELECT 1 FROM trust_signals WHERE organization_id = 'default' AND signal_type = 'guarantee');
