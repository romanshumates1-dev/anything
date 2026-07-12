-- 005_user_roles.sql
-- Platform RBAC: role column on the EXISTING better-auth user table
-- (public."user" — NOT neon_auth.user, which is Neon's managed schema and
-- unused by app code). ADMIN | MEMBER, default MEMBER. Idempotent.
--
-- Seed: roman.shumate@dealswiftautomation.com is upgraded to ADMIN when the
-- account exists. If it does not exist yet, the better-auth user.create hook
-- (SEED_ADMIN_EMAILS in src/lib/auth.ts) grants ADMIN on first signup — we
-- deliberately do NOT pre-insert a user row here, because better-auth rejects
-- sign-up for an email that already has a user row (it would lock the owner
-- out of registering).

ALTER TABLE public."user" ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'MEMBER';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_role_check' AND conrelid = 'public."user"'::regclass
  ) THEN
    ALTER TABLE public."user" ADD CONSTRAINT user_role_check CHECK (role IN ('ADMIN','MEMBER'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_role ON public."user" (role);

UPDATE public."user"
SET role = 'ADMIN'
WHERE lower(email) = 'roman.shumate@dealswiftautomation.com'
  AND role <> 'ADMIN';

COMMENT ON COLUMN public."user".role IS
  'Platform role: ADMIN | MEMBER. MIN_ACCESS_ROLE (default ADMIN) gates app access; admin surfaces require ADMIN. Managed via /api/admin/users.';
