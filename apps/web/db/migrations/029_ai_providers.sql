-- ============================================================================
-- AI providers - customer-managed AI provider configurations
-- Supports: platform-managed, bring-your-own-key, self-hosted
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ai_providers (
  id text PRIMARY KEY DEFAULT 'ai_' || gen_random_uuid()::text,
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider_type text NOT NULL CHECK (provider_type IN ('platform', 'byo', 'ollama')),
  api_key_encrypted text,
  base_url text,
  model text,
  is_active boolean NOT NULL DEFAULT false,
  failover_order jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_providers_org ON public.ai_providers (organization_id);
CREATE INDEX IF NOT EXISTS idx_ai_providers_active ON public.ai_providers (is_active);