-- ============================================================================
-- Tenant-isolation fix for the legacy campaigns/campaign_leads tables.
--
-- These two tables (db/schema.sql:48-70, "CI TEST SCHEMA BOOTSTRAP") predate
-- multi-tenancy and were the one gap migration 030 missed when it added
-- organization_id to every other table (030's own comment lists "campaigns"
-- as already scoped, but that referred to the *outreach_campaigns* system
-- from campaign-pipeline-schema.sql, not this older singular `campaigns`
-- table — confirmed by grepping every migration 001-041 for a CREATE/ALTER
-- touching `public.campaigns`: none exists before this file).
--
-- Real-world impact before this migration: /api/campaigns (GET/POST),
-- /api/campaigns/[id]/launch, and /api/campaigns/[id]/leads did zero
-- organization filtering — any authenticated user, in any org, could list,
-- create, launch (i.e. trigger real SMS sends via the job queue), or read
-- the lead roster of every other org's legacy campaigns just by knowing/
-- guessing a small sequential integer id.
--
-- Mirrors the exact pattern migration 022/030 used for `organizations`/
-- `leads`: add nullable column -> backfill to the default org (matches
-- getOrganization()'s own fallback-to-org_default behavior) -> enforce
-- NOT NULL -> index. campaign_leads also gets its own organization_id
-- (denormalized from its parent campaign) so it matches the sibling
-- outreach `campaign_contacts` table's shape and can never be queried
-- unscoped even if a future call site forgets the join to `campaigns`.
-- ============================================================================

ALTER TABLE public.campaigns
ADD COLUMN IF NOT EXISTS organization_id text REFERENCES public.organizations(id);
UPDATE public.campaigns SET organization_id = 'org_default' WHERE organization_id IS NULL;
ALTER TABLE public.campaigns ALTER COLUMN organization_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_campaigns_org ON public.campaigns (organization_id);

ALTER TABLE public.campaign_leads
ADD COLUMN IF NOT EXISTS organization_id text REFERENCES public.organizations(id);
UPDATE public.campaign_leads cl
SET organization_id = c.organization_id
FROM public.campaigns c
WHERE cl.campaign_id = c.id AND cl.organization_id IS NULL;
ALTER TABLE public.campaign_leads ALTER COLUMN organization_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_campaign_leads_org ON public.campaign_leads (organization_id);
