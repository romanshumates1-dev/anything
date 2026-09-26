/**
 * LEGACY ALIAS — POST /api/inbound/sms (shim only).
 *
 * This route predates the hardened canonical webhook at /api/sms/inbound and
 * duplicated it with three real defects (found by the 2026-09-26 independent
 * re-review):
 *   1. FAIL-OPEN AUTH: X-Twilio-Signature was only checked when the CALLER
 *      sent the header — omitting it skipped validation entirely, so any
 *      unauthenticated party could process inbound SMS, flip lead statuses
 *      and enqueue negotiation jobs.
 *   2. TIMING ORACLE: the HMAC was compared with `signature === expected`.
 *   3. CROSS-TENANT: lead resolution picked an arbitrary tenant's lead by
 *      phone (`ORDER BY created_at DESC LIMIT 1`, no organization predicate)
 *      — the Finding-13 class.
 *
 * Rather than maintain two inbound-SMS implementations, ALL processing now
 * lives in the canonical handler (timing-safe Twilio HMAC + timing-safe
 * x-sms-secret simulator gate, both fail-closed; MessageSid dedup;
 * platform-wide opt-out; tenant-correct lead routing). This file must stay a
 * pure delegate.
 *
 * NOTE: canonical JSON bodies use `{ from, text }` (not Twilio's
 * `From`/`Body`); form-encoded Twilio posts are validated exactly as the
 * canonical route validates them.
 *
 * Ratchet: `src/app/api/__tests__/security/secret-compare-guard.test.ts`
 * asserts this file keeps its delegation and gains no own auth/SQL logic.
 */
import { NextRequest } from 'next/server';
import { POST as canonicalPost } from '../../sms/inbound/route';

export async function POST(request: NextRequest) {
  return canonicalPost(request);
}
