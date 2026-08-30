-- ============================================================================
-- Legal documents - editable templates for ToS, Privacy, etc.
-- Displayed at registration, checkout, and settings
-- Required acceptance before account activation
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.legal_documents (
  id text PRIMARY KEY DEFAULT 'legal_' || gen_random_uuid()::text,
  document_type text NOT NULL CHECK (document_type IN ('terms_of_service', 'privacy_policy', 'acceptable_use', 'subscription_agreement', 'revenue_share', 'refund_policy')),
  title text NOT NULL,
  content text NOT NULL, -- Markdown/HTML content
  version text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  requires_acceptance boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_documents_type ON public.legal_documents (document_type);
CREATE INDEX IF NOT EXISTS idx_legal_documents_active ON public.legal_documents (is_active);

-- Track user acceptance of legal documents
CREATE TABLE IF NOT EXISTS public.legal_acceptances (
  id text PRIMARY KEY DEFAULT 'accept_' || gen_random_uuid()::text,
  user_id text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  document_id text NOT NULL REFERENCES public.legal_documents(id),
  document_type text NOT NULL,
  version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  ip_address text
);

CREATE INDEX IF NOT EXISTS idx_legal_acceptances_user ON public.legal_acceptances (user_id);