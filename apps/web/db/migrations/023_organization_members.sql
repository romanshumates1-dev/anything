-- ============================================================================
-- Organization members - links users to organizations with roles
-- Roles: OWNER, ADMIN, MANAGER, AGENT, MEMBER, VIEWER
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.organization_members (
  id text PRIMARY KEY DEFAULT 'om_' || gen_random_uuid()::text,
  user_id text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'MANAGER', 'AGENT', 'MEMBER', 'VIEWER')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_organization_members_user ON public.organization_members (user_id);
CREATE INDEX IF NOT EXISTS idx_organization_members_org ON public.organization_members (organization_id);
CREATE INDEX IF NOT EXISTS idx_organization_members_role ON public.organization_members (role);