/**
 * Phase T — SMS driver mode resolution + the demo allowlist.
 *
 * Modes: 'mock' | 'twilio-demo' | 'twilio-live'.
 *   mock        — no Twilio config; sends simulated (dev / no creds).
 *   twilio-demo — Twilio configured AND the `twilioDemo` flag is ON. Exercises
 *                 the REAL Twilio API but ONLY to verified numbers (allowlist).
 *   twilio-live — Twilio configured, flag off. Real sends to any recipient
 *                 (post-A2P; a caution state pre-A2P).
 *
 * HONEST ENGINEERING NOTE (encoded here + in UI copy): there is no legitimate
 * "cheap high-limit" bypass of A2P for cold traffic — unregistered routes get
 * carrier-filtered and create compliance exposure. Demo is allowlist-ONLY. The
 * documented legit higher-throughput path is toll-free verification (see
 * TollFreeStub + DEPLOY.md).
 */
import sql from '@/app/api/utils/sql';
import { getTwilioConfig } from './twilio-adapter';

export type SmsMode = 'mock' | 'twilio-demo' | 'twilio-live';

export function resolveSmsMode(twilioDemoOn: boolean): SmsMode {
  const configured = getTwilioConfig() !== null;
  if (!configured) return 'mock';
  return twilioDemoOn ? 'twilio-demo' : 'twilio-live';
}

/**
 * The demo-mode allowlist IS the B1 verified-numbers table
 * (`test_phone_numbers WHERE verified = true`) — not a duplicate. A cold list
 * physically cannot receive demo traffic because unverified numbers are gated
 * out at dispatch time. This is the safety property Phase T tests.
 */
export async function isVerifiedDemoRecipient(phone: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM test_phone_numbers WHERE phone = ${phone} AND verified = true LIMIT 1
  `;
  return rows.length > 0;
}
