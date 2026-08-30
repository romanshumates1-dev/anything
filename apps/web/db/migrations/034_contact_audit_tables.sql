-- Migration 034 - Contact Messages + Admin Audit Log
-- (header was markdown '#' — invalid SQL, broke the canonical migrator; BREAKAGE_TABLE #24)

-- Contact messages table for form submissions
CREATE TABLE IF NOT EXISTS public.contact_messages (
  id text PRIMARY KEY DEFAULT 'contact_' || gen_random_uuid()::text,
  name text NOT NULL,
  email text NOT NULL,
  company text,
  subject text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text
);

CREATE INDEX IF NOT EXISTS idx_contact_messages_email ON public.contact_messages (email);
CREATE INDEX IF NOT EXISTS idx_contact_messages_created ON public.contact_messages (created_at DESC);

-- Admin audit log for all admin actions
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id text PRIMARY KEY DEFAULT 'audit_' || gen_random_uuid()::text,
  actor_id text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  action text NOT NULL, -- 'ban', 'unban', 'suspend', 'refund', 'approve_review', 'delete_user', etc.
  target_type text NOT NULL, -- 'user', 'campaign', 'review', 'subscription', etc.
  target_id text,
  metadata jsonb,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_actor ON public.admin_audit_log (actor_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created ON public.admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_action ON public.admin_audit_log (action);