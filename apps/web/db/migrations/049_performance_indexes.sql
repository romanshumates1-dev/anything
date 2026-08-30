-- 049_performance_indexes.sql
-- Phase 13: indexes on hot paths identified by EXPLAIN ANALYZE.
--
-- Hot paths (every dispatch now hits compliance_gate lookup):
--   1. compliance_gates lookup (in EVERY cold dispatch's hot path since Phase 0A)
--   2. contact lookup by score/jurisdiction (lead finder + call queue)
--   3. buyer match by zip+price+cash_flag (JV intake + matched-first dispo)
--   4. job-queue polling (FOR UPDATE SKIP LOCKED on pending jobs)
--   5. resurrection_sent_log idempotency check (per-lead per-sequence-day)
--   6. dnc_registry phone lookup (every cold SMS dispatch)
--   7. message_events outbound dedup (Phase 12 duplicate-send detector)

-- 1. Compliance gate: org + jurisdiction + channel (exact match in every cold dispatch)
CREATE INDEX IF NOT EXISTS idx_compliance_gates_org_jur_chan
  ON compliance_gates (organization_id, jurisdiction, channel);

-- 2a. Lead score lookup (call queue ORDER BY score DESC)
CREATE INDEX IF NOT EXISTS idx_leads_org_score
  ON leads (organization_id, ((metadata->>'distress_score')::int) DESC NULLS LAST)
  WHERE status NOT IN ('dead', 'converted');

-- 2b. Lead jurisdiction lookup (resurrection + capacity planner)
CREATE INDEX IF NOT EXISTS idx_leads_org_status_updated
  ON leads (organization_id, status, updated_at DESC);

-- 3. Buyer match: zip + price band + cash flag (JV intake matched-buyer lookup)
--    zip_codes is a text[] column (migration 047), so this is a GIN partial
--    index on the array; cash_buyer and price band filter post-match.
CREATE INDEX IF NOT EXISTS idx_buyers_org_zip_cash
  ON buyers USING GIN (zip_codes)
  WHERE verified = true;

-- 4. Job-queue polling: pending jobs by run_at (the FOR UPDATE SKIP LOCKED path)
--    Already has a partial index from migration 001; add a covering index for
--    the full WHERE clause the poller uses.
CREATE INDEX IF NOT EXISTS idx_jobs_poll
  ON jobs (run_at ASC, status, attempts, max_attempts)
  WHERE status IN ('pending', 'failed');

-- 5. Resurrection sent log: idempotency check (org + lead + day)
CREATE INDEX IF NOT EXISTS idx_resurrection_sent_log_lookup
  ON resurrection_sent_log (organization_id, lead_id, sequence_day);

-- 6. DNC registry phone lookup (every cold SMS dispatch)
CREATE INDEX IF NOT EXISTS idx_dnc_registry_phone
  ON dnc_registry (phone);

-- 7. Message events outbound dedup (Phase 12 duplicate-send detector)
CREATE INDEX IF NOT EXISTS idx_message_events_dedup
  ON message_events (direction, created_at DESC, campaign_id)
  WHERE direction = 'outbound';

-- 8. Compliance records opt-out lookup (dispatchGate.isSuppressed — every send)
--    This is the single hottest read in the system; ensure it is covered.
CREATE INDEX IF NOT EXISTS idx_compliance_records_optout
  ON compliance_records (target, type)
  WHERE type = 'opt-out';

-- 9. Stage transitions by lead (funnel analytics join)
CREATE INDEX IF NOT EXISTS idx_stage_transitions_lead
  ON stage_transitions (lead_id, created_at DESC);

-- 10. Call attempts by lead (call queue LEFT JOIN LATERAL)
CREATE INDEX IF NOT EXISTS idx_call_attempts_lead_org
  ON call_attempts (lead_id, organization_id, attempted_at DESC);
