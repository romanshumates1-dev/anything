import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time equality for shared-secret webhook gates.
 *
 * WHY: seven inbound endpoints (sms/inbound, outreach/keyword-inbound,
 * compliance/opt-out, email/inbound, email/ses-events, cron/earnings,
 * system/cron) authenticate with a static secret supplied by the caller.
 * Comparing those with `!==` / `===` short-circuits on the first differing
 * byte, so an attacker who can measure response latency can recover the
 * secret one character at a time (classic timing oracle).
 *
 * HOW: both sides are hashed to a fixed 32-byte SHA-256 digest before
 * `timingSafeEqual`. Hashing first means (a) the comparison always operates
 * on equal-length buffers, so no early length check leaks the secret's
 * length, and (b) the comparison itself runs in constant time regardless of
 * where the first difference occurs.
 *
 * FAILS CLOSED: a missing or empty provided/expected value returns false.
 * An unset environment secret can therefore never authenticate anyone —
 * including when the caller also omits the credential entirely.
 */
export function timingSafeSecretEqual(
  provided: string | null | undefined,
  expected: string | null | undefined
): boolean {
  if (typeof provided !== 'string') return false;
  if (typeof expected !== 'string') return false;
  if (provided.length === 0 || expected.length === 0) return false;

  const a = createHash('sha256').update(provided, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}
