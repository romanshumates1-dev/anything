import sql from '@/app/api/utils/sql';
import { logEvent } from './logger';

/**
 * Check consent for a target across ALL channels (aligned with dispatchGate.isSuppressed).
 *
 * FIX: Removed channel-specific check. An opt-out on ANY channel now suppresses
 * the target everywhere, matching dispatchGate.isSuppressed semantics. This is
 * the correct behavior because STOP means stop on every channel, permanently.
 *
 * If you need channel-specific opt-out (rare), use checkChannelSpecificConsent.
 */
export async function checkConsent(target: string, channel: 'sms' | 'email') {
  // Check for opt-out on ANY channel (STOP suppresses everything)
  const rows = await sql`
    SELECT * FROM compliance_records
    WHERE target = ${target}
    AND type = 'opt-out'
    LIMIT 1
  `;

  return rows.length === 0; // Returns true if NOT opted out on any channel
}

/**
 * Check consent for a specific channel only (use sparingly - most cases should
 * use checkConsent which honors cross-channel opt-outs).
 */
export async function checkChannelSpecificConsent(target: string, channel: 'sms' | 'email') {
  const rows = await sql`
    SELECT * FROM compliance_records
    WHERE target = ${target}
    AND channel = ${channel}
    AND type = 'opt-out'
    LIMIT 1
  `;

  return rows.length === 0;
}

/**
 * Record an opt-out and suppress the PERSON, not just the identifier.
 *
 * The origin row is written first, exactly as before, so every existing
 * consumer of its metadata shape is unaffected. The fan-out is then additive:
 * every other identifier held for the same lead (phone, email, mailing
 * address) also gets a suppression row.
 *
 * WHY THE FAN-OUT LIVES HERE rather than at the three call sites
 * (compliance/opt-out route, services/inboundSms, sms/inbound route): a call
 * site that forgets it is a silent compliance failure — the unsubscribe
 * appears honoured, and the same person keeps receiving on another channel.
 * Putting it in the one function they all already call makes forgetting
 * impossible, and means a fourth channel added later inherits it for free.
 *
 * Proven live before wiring (scripts/verify-lead-suppression.mjs): an EMAIL
 * unsubscribe now suppresses that lead's PHONE and MAILING ADDRESS.
 *
 * Fan-out failure never blocks the origin suppression — if lead lookup throws,
 * the person who asked to stop is still stopped on the channel they used. A
 * partial suppression beats none.
 */
export async function registerOptOut(
  target: string,
  channel: 'sms' | 'email' | 'mail',
  metadata: any = {}
) {
  await sql`
    INSERT INTO compliance_records (target, type, channel, metadata)
    VALUES (${target}, 'opt-out', ${channel}, ${JSON.stringify(metadata)})
    ON CONFLICT (target, channel, type) DO UPDATE
      SET metadata = EXCLUDED.metadata, created_at = CURRENT_TIMESTAMP
  `;

  await logEvent('compliance_opt_out', 'compliance', target, { channel, ...metadata });

  try {
    const { suppressLeadAllChannels } = await import('@/app/api/services/leadSuppression');
    await suppressLeadAllChannels({
      identifier: target,
      channel,
      reason: metadata?.reason ?? 'opt-out',
    });
  } catch (error) {
    // Loud, but non-fatal: the origin channel is already suppressed above.
    console.error('[compliance] cross-channel opt-out fan-out failed', error);
  }
}

export async function registerConsent(
  target: string,
  channel: 'sms' | 'email',
  metadata: any = {}
) {
  // Re-consent must clear any prior opt-out so the lead is reachable again.
  // Execute as sequential queries - Neon's transaction() with array may not be reliable
  // The DELETE must complete before INSERT to avoid constraint issues
  await sql`
    DELETE FROM compliance_records
    WHERE target = ${target} AND channel = ${channel} AND type = 'opt-out'
  `;
  await sql`
    INSERT INTO compliance_records (target, type, channel, metadata)
    VALUES (${target}, 'consent', ${channel}, ${JSON.stringify(metadata)})
    ON CONFLICT (target, channel, type) DO UPDATE
      SET metadata = EXCLUDED.metadata, created_at = CURRENT_TIMESTAMP
  `;

  await logEvent('compliance_consent', 'compliance', target, { channel, ...metadata });
}
