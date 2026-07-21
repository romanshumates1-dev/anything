-- ============================================================================
-- Usage ledger - track consumption against subscription limits
-- Used for SMS, AI requests, storage, API calls, automations, workflows
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.usage_ledger (
  id text PRIMARY KEY DEFAULT 'usage_' || gen_random_uuid()::text,
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  metric_type text NOT NULL CHECK (metric_type IN ('sms', 'ai_request', 'storage', 'api_rate', 'automation', 'workflow')),
  amount integer NOT NULL,
  unit text NOT NULL DEFAULT 'count',
  recorded_at timestamptz NOT NULL DEFAULT now(),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_ledger_org ON public.usage_ledger (organization_id);
CREATE INDEX IF NOT EXISTS idx_usage_ledger_metric ON public.usage_ledger (metric_type);
CREATE INDEX IF NOT EXISTS idx_usage_ledger_period ON public.usage_ledger (period_start, period_end);