-- ============================================================================
-- Organizations table for multi-tenancy
-- Each organization represents a tenant with isolated data and billing
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.organizations (
  id text PRIMARY KEY DEFAULT 'org_' || gen_random_uuid()::text,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_organizations_slug ON public.organizations (slug);