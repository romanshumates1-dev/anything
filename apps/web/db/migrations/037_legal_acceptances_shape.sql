-- Migration 037 — converge legal_acceptances to the acceptance model Phase 3
-- actually uses.
--
-- The Phase 3 design keys an acceptance on (user_id, doc_type, version) with
-- ip + user_agent captured server-side — content now lives in versioned
-- markdown (src/lib/legal.ts), NOT the legal_documents table. The 032 shape
-- forced document_id NOT NULL with an FK into legal_documents, which meant
-- acceptance could not be recorded unless that (orphaned, never-seeded) table
-- had a matching row — a dead-on-arrival wall (BREAKAGE_TABLE #31).
--
-- Changes: drop the document_id FK + NOT NULL (keep the column, now optional/
-- legacy), add user_agent, and add a partial unique index so re-accepting the
-- SAME version is idempotent while a new version writes a new row.
-- ============================================================================

ALTER TABLE public.legal_acceptances
  DROP CONSTRAINT IF EXISTS legal_acceptances_document_id_fkey;

ALTER TABLE public.legal_acceptances
  ALTER COLUMN document_id DROP NOT NULL;

ALTER TABLE public.legal_acceptances
  ADD COLUMN IF NOT EXISTS user_agent text;

-- One acceptance row per (user, doc_type, version). Re-accepting the same
-- version is a no-op; a version bump inserts a fresh row (the re-accept gate).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_legal_acceptance_user_doc_version
  ON public.legal_acceptances (user_id, document_type, version);
