-- Migration 095 — message_events: add the columns the send/log paths already write.
--
-- WHY
-- ---
-- Four route handlers already INSERT into public.message_events using columns
-- that migration 001 never created, so those statements fail at runtime with
-- `column "..." does not exist` (SQLSTATE 42703). Verified against the live
-- schema on 2026-09-30: message_events has exactly these 13 columns —
--
--   id, organization_id, campaign_id, contact_id, direction, provider,
--   provider_message_id, status, segment_count, cost_cents, ai_cost_cents,
--   metadata, created_at
--
-- and the callers reference conversation_id, lead_id, channel, from_address,
-- to_address, subject, body, external_id and type, none of which exist.
--
-- WHY THE TABLE LOOKED HEALTHY
-- ---------------------------
-- public.message_events currently holds 0 rows. The one caller that swallows
-- its error (`smsOutreachEngine.ts` ends the INSERT with `.catch(console.error)`)
-- hid the failure, so the ledger simply stayed empty and nothing alerted.
--
-- WHAT THIS DOES
-- --------------
-- Purely ADDITIVE and idempotent: new columns are nullable with no default, so
-- no existing row is rewritten and no existing query changes behaviour. The
-- statements that already work keep working.
--
-- contact_id and campaign_id are relaxed to nullable. Migration 001 made both
-- NOT NULL with foreign keys to campaign_contacts / outreach_campaigns, but a
-- message event is not inherently scoped to either:
--
--   * an outbound campaign email is addressed to a raw `leads` row and has no
--     campaign_contacts row at all, so the only ways to satisfy the constraint
--     were to invent a contact id (a data-integrity lie) or drop the row
--     (losing the audit trail this table exists for);
--   * campaign_lead_queue.campaign_id is NULL for all 104,948 rows in the
--     current database, so the send path has no outreach_campaigns id to
--     reference even in principle.
--
-- Dropping NOT NULL is strictly widening: existing NOT NULL behaviour for every
-- caller that does supply a value is unchanged, and no existing row is
-- rewritten.
--
-- ROLLBACK
-- --------
--   ALTER TABLE public.message_events
--     DROP COLUMN conversation_id, DROP COLUMN lead_id, DROP COLUMN channel,
--     DROP COLUMN from_address,  DROP COLUMN to_address, DROP COLUMN subject,
--     DROP COLUMN body,          DROP COLUMN external_id, DROP COLUMN type;
--   ALTER TABLE public.message_events
--     ALTER COLUMN contact_id SET NOT NULL,
--     ALTER COLUMN campaign_id SET NOT NULL;
--
-- The SET NOT NULL steps will fail if any row written since this migration has
-- a NULL in either column, which is the intended guard: check first
--   SELECT count(*) FROM public.message_events
--    WHERE contact_id IS NULL OR campaign_id IS NULL;
--
-- All statements are IF NOT EXISTS, so re-running is a no-op.

ALTER TABLE public.message_events
  ADD COLUMN IF NOT EXISTS conversation_id text,
  ADD COLUMN IF NOT EXISTS lead_id         text,
  ADD COLUMN IF NOT EXISTS channel         text,
  ADD COLUMN IF NOT EXISTS from_address    text,
  ADD COLUMN IF NOT EXISTS to_address      text,
  ADD COLUMN IF NOT EXISTS subject         text,
  ADD COLUMN IF NOT EXISTS body            text,
  ADD COLUMN IF NOT EXISTS external_id     text,
  ADD COLUMN IF NOT EXISTS type            text;

-- Written by a path that legitimately has no campaign_contacts /
-- outreach_campaigns row. See header.
ALTER TABLE public.message_events
  ALTER COLUMN contact_id  DROP NOT NULL,
  ALTER COLUMN campaign_id DROP NOT NULL;
