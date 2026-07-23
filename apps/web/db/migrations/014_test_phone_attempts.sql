-- 014_test_phone_attempts.sql
-- Second root cause of "cannot add/verify test numbers" (bug #18): the POST
-- add route INSERTs `attempts` and the verify route reads/updates it, but the
-- column was never created (migration 001 defined the table without it). So the
-- add INSERT threw "column attempts does not exist" → 500 for any normal
-- number. (bug #14's missing test_phone_otp_log was the first cause; the
-- DNC-suppressed number in the P3 check short-circuited to 409 before the
-- INSERT, hiding this one.) Idempotent.

ALTER TABLE public.test_phone_numbers
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.test_phone_numbers.attempts IS
  'OTP verification attempts; the verify route rejects after 3 (10-min expiry).';
