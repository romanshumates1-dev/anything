-- ============================================================================
-- 044 — lead_sources.dataset_id, for PERMITTED-source automated fetch.
--
-- The registry (006) records WHERE a source lives (`url`, the portal root) and
-- WHETHER we may fetch it (`terms_status`), but not WHICH dataset to pull. For
-- a Socrata/SODA portal the portal root is not addressable on its own — the
-- API path is `<portal>/resource/<4x4-id>.json`, so the resource id has to be
-- stored per source.
--
-- Deliberately nullable and deliberately NOT seeded with a guessed id: the
-- fetch endpoint returns a clear `source_missing_dataset` error when it is
-- absent, which is a far better failure than a fabricated 4x4 producing an
-- upstream 404 that looks like a bug in our code. The owner sets it once, from
-- the dataset's own API docs page.
--
-- Only meaningful for sources whose terms_status is PERMITTED; MANUAL_ONLY
-- sources are ingested by file upload and never touch this column.
-- ============================================================================

ALTER TABLE public.lead_sources
  ADD COLUMN IF NOT EXISTS dataset_id text;

COMMENT ON COLUMN public.lead_sources.dataset_id IS
  'Socrata/SODA resource id (4x4, e.g. "abcd-1234") appended as <url>/resource/<dataset_id>.json by the automated-fetch endpoint. NULL for MANUAL_ONLY sources.';
