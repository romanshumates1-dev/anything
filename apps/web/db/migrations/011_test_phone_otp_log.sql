-- 011_test_phone_otp_log.sql
-- The OTP send path (test-phones/route.ts) rate-limits on this table
-- (max 3 sends / number / hour), but it was never created — so EVERY OTP send
-- threw "relation test_phone_otp_log does not exist" -> 500. This is the root
-- cause of the "cannot add / verify test numbers" bug. Idempotent.

CREATE TABLE IF NOT EXISTS public.test_phone_otp_log (
  id              text PRIMARY KEY,
  organization_id text NOT NULL,
  phone           text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- The rate-limit query filters by (phone, organization_id, created_at window).
CREATE INDEX IF NOT EXISTS test_phone_otp_log_lookup_idx
  ON public.test_phone_otp_log (phone, organization_id, created_at);

COMMENT ON TABLE public.test_phone_otp_log IS
  'One row per OTP send. Rate-limits test-phone verification to 3 sends/number/hour.';
