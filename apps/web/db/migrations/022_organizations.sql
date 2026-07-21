-- ============================================================================
-- Organizations table for multi-tenancy
-- Each organization represents a tenant with isolated data and billing
--
-- NOTE: migration 001 already creates public.organizations WITHOUT slug
-- (id, name, owner_user_id, timezone). This migration must therefore
-- CONVERGE the existing table, not assume it creates it. The original
-- version indexed `slug` unconditionally and failed on every DB that ran
-- 001 first (i.e., all of them) — BREAKAGE_TABLE #23.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.organizations (
  id text PRIMARY KEY DEFAULT 'org_' || gen_random_uuid()::text,
  name text NOT NULL,
  slug text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Converge the legacy (001) shape: add slug, backfill deterministically, then
-- enforce NOT NULL + uniqueness. Idempotent on re-run.
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS slug text;

UPDATE public.organizations
SET slug = lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(md5(id), 1, 6)
WHERE slug IS NULL;

ALTER TABLE public.organizations ALTER COLUMN slug SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_slug ON public.organizations (slug);
