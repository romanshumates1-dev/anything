-- 083_signup_restrictions.sql
-- Add signup restriction settings to app_settings table.
-- Allows admin to restrict signups to specific email domains.
-- Idempotent: uses INSERT ON CONFLICT.

-- Insert default signup restriction settings
INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'signup_restrictions',
  '{"signup_restricted": false, "allowed_email_domains": ["dealswiftautomation.com"]}'::jsonb,
  now()
)
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE public.app_settings IS
  'Runtime app settings (key/value). Includes signup_restrictions for domain-based access control.';
