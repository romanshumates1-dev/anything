-- ============================================================================
-- Invitations - invite users to organizations
-- Tokens are single-use, expire after 7 days
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.invitations (
  id text PRIMARY KEY DEFAULT 'inv_' || gen_random_uuid()::text,
  email text NOT NULL,
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'MANAGER', 'AGENT', 'MEMBER', 'VIEWER')),
  token text NOT NULL UNIQUE,
  invited_by text NOT NULL REFERENCES public."user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days')
);

CREATE INDEX IF NOT EXISTS idx_invitations_email ON public.invitations (email);
CREATE INDEX IF NOT EXISTS idx_invitations_token ON public.invitations (token);
CREATE INDEX IF NOT EXISTS idx_invitations_org ON public.invitations (organization_id);