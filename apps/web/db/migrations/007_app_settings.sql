-- 007_app_settings.sql
-- Generic key/value app settings (admin-editable at runtime, no redeploy).
-- First consumer: the AI provider toggle (Anthropic hosted API vs local Ollama).
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.app_settings IS
  'Runtime app settings (key/value). e.g. key=ai_provider -> {provider, ollamaBaseUrl, ollamaModel}. Read with env/default fallback so an empty table is fully functional.';
