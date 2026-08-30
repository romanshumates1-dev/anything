-- Migration 040 — index message_events.provider_message_id.
-- The new /api/sms/status delivery-callback receiver (BREAKAGE_TABLE #33)
-- looks up a row by provider_message_id (Twilio's MessageSid) on every
-- callback; this was previously an unindexed lookup path with no callers.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_message_events_provider_message_id
  ON public.message_events (provider_message_id)
  WHERE provider_message_id IS NOT NULL;
