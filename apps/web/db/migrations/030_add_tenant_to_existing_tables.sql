-- ============================================================================
-- Add organization_id to leads table for tenant isolation
-- Backfill with a default organization ID, then enforce NOT NULL
-- Note: campaigns, contracts, and negotiation_tables already have organization_id
-- from earlier migrations
-- ============================================================================

-- First, create a default organization for existing data
INSERT INTO public.organizations (id, name, slug)
VALUES ('org_default', 'Default Organization', 'default-org')
ON CONFLICT (id) DO NOTHING;

-- Add organization_id to leads (the only table missing it)
ALTER TABLE public.leads
ADD COLUMN IF NOT EXISTS organization_id text REFERENCES public.organizations(id);
UPDATE public.leads SET organization_id = 'org_default' WHERE organization_id IS NULL;
ALTER TABLE public.leads ALTER COLUMN organization_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_org ON public.leads (organization_id);
