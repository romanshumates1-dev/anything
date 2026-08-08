-- 052_optimization_loop.sql
-- ML-free campaign optimization: track performance, enable A/B testing

-- Template performance tracking
CREATE TABLE IF NOT EXISTS template_performance (
  id SERIAL PRIMARY KEY,
  organization_id TEXT REFERENCES organizations(id),
  template_key TEXT NOT NULL, -- e.g. 'initial_offer', 'follow_up_adjust'
  variant TEXT, -- e.g. 'A', 'B', 'control'

  -- Metrics
  sent_count INT DEFAULT 0,
  replied_count INT DEFAULT 0,
  positive_count INT DEFAULT 0, -- interested replies
  negative_count INT DEFAULT 0, -- not interested
  neutral_count INT DEFAULT 0,

  -- Performance
  reply_rate FLOAT, -- replied / sent
  positive_rate FLOAT, -- positive / replied

  -- Timestamps
  first_sent_at TIMESTAMPTZ,
  last_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(organization_id, template_key, variant)
);

CREATE INDEX IF NOT EXISTS idx_template_perf_org ON template_performance(organization_id);
CREATE INDEX IF NOT EXISTS idx_template_perf_key ON template_performance(template_key);

-- Campaign optimization settings
CREATE TABLE IF NOT EXISTS campaign_optimization_settings (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id),

  -- Optimization enabled/disabled
  enabled BOOLEAN DEFAULT false,

  -- A/B testing settings
  ab_test_enabled BOOLEAN DEFAULT false,
  ab_test_split FLOAT DEFAULT 0.5, -- 50/50 split
  min_sample_size INT DEFAULT 50, -- min sends before declaring winner

  -- Adaptive template selection
  adaptive_selection BOOLEAN DEFAULT false,
  winner_threshold FLOAT DEFAULT 0.10, -- 10% better reply rate = switch

  -- Performance thresholds
  min_reply_rate FLOAT DEFAULT 0.05, -- 5% reply rate minimum
  alert_on_poor_performance BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Message send log (for detailed tracking)
CREATE TABLE IF NOT EXISTS message_send_log (
  id SERIAL PRIMARY KEY,
  organization_id TEXT REFERENCES organizations(id),
  lead_id INT REFERENCES leads(id),
  template_key TEXT NOT NULL,
  variant TEXT,

  -- Message details
  subject TEXT,
  body TEXT,
  sent_at TIMESTAMPTZ DEFAULT now(),

  -- Outcome
  replied BOOLEAN DEFAULT false,
  reply_at TIMESTAMPTZ,
  reply_sentiment TEXT, -- 'positive', 'negative', 'neutral'

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_send_log_org ON message_send_log(organization_id);
CREATE INDEX IF NOT EXISTS idx_send_log_lead ON message_send_log(lead_id);
CREATE INDEX IF NOT EXISTS idx_send_log_template ON message_send_log(template_key, variant);

-- Function to update template performance stats
CREATE OR REPLACE FUNCTION update_template_performance()
RETURNS TRIGGER AS $$
BEGIN
  -- When a reply is logged, update template stats
  IF NEW.replied = true AND OLD.replied = false THEN
    INSERT INTO template_performance (
      organization_id,
      template_key,
      variant,
      sent_count,
      replied_count,
      positive_count,
      negative_count,
      neutral_count
    )
    VALUES (
      NEW.organization_id,
      NEW.template_key,
      COALESCE(NEW.variant, 'default'),
      0, -- sent_count updated separately
      1,
      CASE WHEN NEW.reply_sentiment = 'positive' THEN 1 ELSE 0 END,
      CASE WHEN NEW.reply_sentiment = 'negative' THEN 1 ELSE 0 END,
      CASE WHEN NEW.reply_sentiment = 'neutral' THEN 1 ELSE 0 END
    )
    ON CONFLICT (organization_id, template_key, variant)
    DO UPDATE SET
      replied_count = template_performance.replied_count + 1,
      positive_count = template_performance.positive_count +
        CASE WHEN NEW.reply_sentiment = 'positive' THEN 1 ELSE 0 END,
      negative_count = template_performance.negative_count +
        CASE WHEN NEW.reply_sentiment = 'negative' THEN 1 ELSE 0 END,
      neutral_count = template_performance.neutral_count +
        CASE WHEN NEW.reply_sentiment = 'neutral' THEN 1 ELSE 0 END,
      reply_rate = CAST(replied_count + 1 AS FLOAT) / NULLIF(sent_count, 0),
      positive_rate = CAST(positive_count + CASE WHEN NEW.reply_sentiment = 'positive' THEN 1 ELSE 0 END AS FLOAT) / NULLIF(replied_count + 1, 0),
      last_sent_at = NEW.sent_at,
      updated_at = now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_template_performance
AFTER UPDATE ON message_send_log
FOR EACH ROW
EXECUTE FUNCTION update_template_performance();

COMMENT ON TABLE template_performance IS 'Tracks performance metrics for each message template variant (ML-free optimization)';
COMMENT ON TABLE campaign_optimization_settings IS 'Organization-level settings for campaign optimization';
COMMENT ON TABLE message_send_log IS 'Detailed log of every message sent for performance analysis';
