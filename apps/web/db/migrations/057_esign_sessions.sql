-- E-sign sessions table for self-hosted e-sign
-- Stores signing session tokens that were previously only in-memory

CREATE TABLE IF NOT EXISTS esign_sessions (
  token TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  signer_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT false
);

-- Indexes for lookups
CREATE INDEX IF NOT EXISTS idx_esign_sessions_document ON esign_sessions(document_id);
CREATE INDEX IF NOT EXISTS idx_esign_sessions_expires ON esign_sessions(expires_at) WHERE NOT used;

-- Cleanup job can remove expired sessions
-- DELETE FROM esign_sessions WHERE expires_at < now() - interval '30 days';
