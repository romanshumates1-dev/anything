-- ============================================================================
-- Revenue sharing - configurable split percentages per organization
-- Used for partner arrangements (e.g., 25/75, 50/50, 90/10 splits)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.revenue_sharing (
  id text PRIMARY KEY DEFAULT 'rs_' || gen_random_uuid()::text,
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform_percentage integer NOT NULL CHECK (platform_percentage >= 0 AND platform_percentage <= 100),
  partner_percentage integer NOT NULL CHECK (partner_percentage >= 0 AND partner_percentage <= 100),
  agreement_template text, -- JSONB template for generating agreements
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Ensure percentages add to 100 (drop-then-add so the file is idempotent --
-- the migrator re-applies every file on every run; BREAKAGE_TABLE #26)
ALTER TABLE public.revenue_sharing DROP CONSTRAINT IF EXISTS chk_revenue_sharing_total;
ALTER TABLE public.revenue_sharing 
ADD CONSTRAINT chk_revenue_sharing_total 
CHECK (platform_percentage + partner_percentage = 100);

CREATE INDEX IF NOT EXISTS idx_revenue_sharing_org ON public.revenue_sharing (organization_id);