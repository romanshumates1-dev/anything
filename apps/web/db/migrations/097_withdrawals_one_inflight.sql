-- Migration 097 — at most ONE in-flight withdrawal per user.
--
-- WHY
-- ---
-- `/api/withdrawals` POST enforces "one at a time" in application code:
--
--     SELECT id FROM withdrawals
--     WHERE user_id = $1 AND status IN ('PENDING','PROCESSING')
--     ... if a row comes back, reject with 409
--     ... otherwise INSERT a new PENDING withdrawal
--
-- That is a read followed by a separate write, with no lock and no unique
-- index between them, so it is a textbook time-of-check/time-of-use race. Two
-- requests arriving together can both observe "none pending" and both insert.
--
-- Why that matters beyond a duplicate row: the earnings claim that follows uses
-- `FOR UPDATE SKIP LOCKED`, which correctly stops two transactions claiming the
-- SAME earnings row - but it lets the second transaction claim a DIFFERENT set
-- of rows while both already passed the separate available-balance read. Two
-- concurrent withdrawals can therefore be admitted against one balance.
--
-- The audit on the live database found no partial unique index on `withdrawals`
-- beyond the primary key, so nothing below the application level prevented it.
-- (The table is currently empty and no user holds more than one in-flight
-- withdrawal, so this is a hardening change, not a repair of existing damage.)
--
-- WHAT THIS DOES
-- --------------
-- Moves the invariant into the schema, where a race cannot defeat it. A partial
-- unique index ignores COMPLETED / FAILED / CANCELLED rows, so a user keeps a
-- full history while only ever having one live request.
--
-- IF EXISTING DATA VIOLATES THIS the migration fails loudly rather than
-- silently picking a winner and leaving an orphaned withdrawal behind.

DO $$
DECLARE
  offenders int;
BEGIN
  SELECT count(*) INTO offenders FROM (
    SELECT user_id FROM withdrawals
    WHERE status IN ('PENDING','PROCESSING')
    GROUP BY user_id HAVING count(*) > 1
  ) d;

  IF offenders > 0 THEN
    RAISE EXCEPTION
      'migration 097 refused: % user(s) hold more than one PENDING/PROCESSING withdrawal; reconcile before constraining',
      offenders;
  END IF;

  CREATE UNIQUE INDEX IF NOT EXISTS idx_withdrawals_one_inflight_per_user
    ON public.withdrawals (user_id)
    WHERE status IN ('PENDING','PROCESSING');
END
$$;