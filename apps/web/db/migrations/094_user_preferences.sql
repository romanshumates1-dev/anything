-- 094_user_preferences.sql
-- The `preferences` JSONB column the app has always assumed.
--
-- CONTEXT
-- /api/user/preferences expects public."user".preferences to exist and stores
-- onboarding/tutorial/UI state there (ALLOWED_KEYS: onboarding_completed,
-- onboarding_checklist, tutorial_progress, notification_preferences, theme,
-- sidebar_collapsed, dashboard_layout). The column was never added by any
-- migration, so on the live database every GET returned {} and every
-- PATCH/PUT was silently swallowed by a "column does not exist" special case:
-- the user-visible symptom is that onboarding/tutorial progress never
-- persisted server-side (browser localStorage masked it).
--
-- Additive and idempotent: no existing row is modified; existing rows get the
-- empty-object default, which is exactly what the API previously reported for
-- them. `NOT NULL DEFAULT '{}'::jsonb` is metadata-only on PostgreSQL 11+
-- (no table rewrite for a non-volatile default).
ALTER TABLE public."user"
  ADD COLUMN IF NOT EXISTS preferences jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public."user".preferences IS
  'Whitelisted UI/onboarding preferences written via /api/user/preferences (onboarding_completed, tutorial_progress, theme, sidebar_collapsed, dashboard_layout, notification_preferences).';
