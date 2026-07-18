/**
 * dispatchGate — the SINGLE gate every outbound dispatch must pass, on EVERY
 * channel (sms | voice | rvm), current and future.
 *
 * WHY SEND-TIME, NOT SCHEDULE-TIME: a step scheduled at 3pm for "4 hours later"
 * may fire at 9:05pm after a queue backlog, a restart, or a DST shift. A check
 * done when the step was *scheduled* is stale by then. This gate runs at the
 * moment of dispatch, so the decision reflects reality.
 *
 * ORDER MATTERS (cheapest/most-absolute first):
 *   1. DNC / opt-out      — absolute, permanent, suppresses EVERY channel
 *   2. beta flag          — an OFF integration must emit zero events
 *   3. consentBasis       — voice/RVM only (TCPA prior-express-consent posture)
 *   4. quiet hours        — 8am-9pm LEAD-LOCAL
 *   5. send-window snap   — cadence steps only (10-11am / 2-4pm lead-local)
 *
 * TIMEZONE: derived from the phone's area code. Unknown/ambiguous → MOST
 * RESTRICTIVE: the send must be legal in EVERY US timezone the number could be
 * in. DST-safe because every comparison goes through Intl with an IANA zone —
 * there is no manual offset arithmetic anywhere in this file.
 */
import sql from '@/app/api/utils/sql';
import { timezonesForPhone } from '@/app/api/utils/area-codes';
import { isBetaFlagOn, type BetaFlagKey } from '@/app/api/utils/betaFlags';
import { getTwilioConfig } from '@/app/api/utils/twilio-adapter';

export type DispatchChannel = 'sms' | 'voice' | 'rvm';

/** Consent bases that permit an automated voice/RVM touch. Anything else = skip. */
export const VALID_CONSENT_BASES = ['manual-list-attested', 'inbound-initiated'] as const;
export type ConsentBasis = (typeof VALID_CONSENT_BASES)[number];

export const QUIET_HOURS = { startHour: 8, endHour: 21 } as const; // 8am–9pm inclusive-exclusive
export const SEND_WINDOWS = [
  { startHour: 10, endHour: 11 },
  { startHour: 14, endHour: 16 },
] as const;

export type DenyCode = 'DNC' | 'FLAG_OFF' | 'NO_CONSENT' | 'QUIET_HOURS' | 'OUTSIDE_WINDOW' | 'PROFILE_NO_COLD' | 'NUMERIC_GUARD' | 'DEMO_NOT_VERIFIED';

export type DispatchDecision =
  | { allow: true; timezones: string[] }
  | { allow: false; code: DenyCode; reason: string; retryAt?: Date; timezones: string[] };

export interface DispatchRequest {
  /** Lead phone — drives both DNC lookup and lead-local timezone. */
  phone: string;
  channel: DispatchChannel;
  /** Which beta flag gates this dispatch (omit for always-on paths). */
  betaFlag?: BetaFlagKey;
  /** Required for voice/rvm. */
  consentBasis?: string | null;
  /** Cadence steps additionally snap to send windows. */
  isCadenceStep?: boolean;
  /**
   * Recipient-requested, non-marketing sends (e.g. the OTP a user just asked
   * for on their own phone). Skips quiet-hours/send-window ONLY — DNC, beta
   * flag, and consent checks always run. TCPA quiet hours restrict
   * solicitations; a verification code the recipient explicitly requested
   * seconds ago is not one, and holding it until morning breaks the flow.
   */
  transactional?: boolean;
  /**
   * Phase N: whether this send is COLD outbound (a first-touch to a lead who
   * has not contacted us). When false-y the field is ignored. A luxury profile
   * sets `coldOutbound:true` with `profileAllowsCold:false` → the gate SKIPS it
   * (luxury is inbound/referral only). Inbound replies pass `coldOutbound:false`.
   */
  coldOutbound?: boolean;
  /** Phase N: the lead's profile's allows_cold_outbound. Only consulted when
   *  coldOutbound is true. Default (undefined) = allowed. */
  profileAllowsCold?: boolean;
  /**
   * Phase A: bounded-negotiation numeric guard. Present ONLY on bounded-mode
   * conversation sends. The final outbound text is parsed; any dollar amount
   * ≠ the computed offer, outside the approved range, or any spelled-amount
   * token → the send is BLOCKED (NUMERIC_GUARD). Defense-in-depth: the model
   * cannot leak a bad number even under adversarial prompting.
   */
  boundedNegotiation?: {
    text: string;
    computedOfferCents: number;
    approvedMinCents: number;
    approvedMaxCents: number;
  };
  /** Injectable clock for tests. */
  now?: Date;
}

/** Lead-local hour (0-23) in an IANA zone. DST-correct: Intl resolves the offset. */
export function localHourIn(tz: string, at: Date): number {
  const s = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(at);
  const h = parseInt(s, 10);
  return h === 24 ? 0 : h; // some ICU builds format midnight as 24
}

function inRange(h: number, startHour: number, endHour: number): boolean {
  return h >= startHour && h < endHour;
}

/** Quiet hours pass ONLY if legal in every candidate zone (most restrictive). */
export function isWithinQuietHours(tzs: string[], at: Date): boolean {
  return tzs.every((tz) => inRange(localHourIn(tz, at), QUIET_HOURS.startHour, QUIET_HOURS.endHour));
}

/** Send window pass ONLY if inside a window in every candidate zone. */
export function isWithinSendWindow(tzs: string[], at: Date): boolean {
  return tzs.every((tz) => {
    const h = localHourIn(tz, at);
    return SEND_WINDOWS.some((w) => inRange(h, w.startHour, w.endHour));
  });
}

/**
 * Next instant that satisfies `predicate`, probed forward in 15-minute steps.
 * Probing (rather than offset math) is deliberate: it is DST-safe by
 * construction and cannot drift across a transition. Capped at 8 days; returns
 * null if no slot (which, for an all-zone intersection, can legitimately happen
 * only if the windows never overlap — the caller then holds the step).
 */
function nextAllowed(from: Date, predicate: (d: Date) => boolean): Date | null {
  const STEP_MS = 15 * 60 * 1000;
  const MAX_STEPS = (8 * 24 * 60) / 15;
  let t = new Date(Math.ceil(from.getTime() / STEP_MS) * STEP_MS);
  for (let i = 0; i < MAX_STEPS; i++) {
    if (predicate(t)) return t;
    t = new Date(t.getTime() + STEP_MS);
  }
  return null;
}

/** True if this target has EVER opted out on ANY channel (STOP suppresses everything, permanently). */
export async function isSuppressed(phone: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM compliance_records
    WHERE target = ${phone} AND type = 'opt-out'
    LIMIT 1
  `;
  return rows.length > 0;
}

/**
 * THE gate. Call immediately before handing a message to a provider.
 * Fail-closed: any unexpected error denies the send.
 */
export async function dispatchGate(req: DispatchRequest): Promise<DispatchDecision> {
  const at = req.now ?? new Date();
  const tzs = timezonesForPhone(req.phone);

  try {
    // 1. DNC / opt-out — absolute, every channel, permanent.
    if (await isSuppressed(req.phone)) {
      return { allow: false, code: 'DNC', reason: 'Recipient opted out (suppressed on all channels)', timezones: tzs };
    }

    // 2. Beta flag — an OFF integration emits zero events.
    if (req.betaFlag && !(await isBetaFlagOn(req.betaFlag))) {
      return { allow: false, code: 'FLAG_OFF', reason: `Beta flag ${req.betaFlag} is off`, timezones: tzs };
    }

    // 2.5 Phase T: demo-mode allowlist. When the SMS driver is in twilio-demo
    // mode, a recipient NOT in the verified-numbers allowlist is SKIPPED before
    // any provider is touched. This is the safety property that makes cold
    // lists physically unable to receive demo traffic. (DNC above still wins.)
    if (req.channel === 'sms' && (await isBetaFlagOn('twilioDemo')) && getTwilioConfig() !== null) {
      const { isVerifiedDemoRecipient } = await import('./smsMode');
      if (!(await isVerifiedDemoRecipient(req.phone))) {
        return {
          allow: false,
          code: 'DEMO_NOT_VERIFIED',
          reason: 'SKIPPED: demo mode, recipient not verified',
          timezones: tzs,
        };
      }
    }

    // 3. consentBasis — voice/RVM only.
    if (req.channel === 'voice' || req.channel === 'rvm') {
      const basis = (req.consentBasis ?? '') as ConsentBasis;
      if (!VALID_CONSENT_BASES.includes(basis)) {
        return {
          allow: false,
          code: 'NO_CONSENT',
          reason: `SKIPPED: no consent basis for ${req.channel} (need one of ${VALID_CONSENT_BASES.join(' | ')})`,
          timezones: tzs,
        };
      }
    }

    // 3.4 Phase A: numeric guard on bounded-negotiation sends. Absolute block —
    // a leaked number is a compliance/authority breach, never retried as-is.
    if (req.boundedNegotiation) {
      const { numericGuard } = await import('./negotiationEngine');
      const verdict = numericGuard(req.boundedNegotiation.text, req.boundedNegotiation);
      if (!verdict.ok) {
        return {
          allow: false,
          code: 'NUMERIC_GUARD',
          reason: `NUMERIC GUARD BLOCKED: ${verdict.reason}`,
          timezones: tzs,
        };
      }
    }

    // 3.5 Phase N: profile forbids cold outbound (luxury = inbound/referral
    // only). Absolute skip, not a timing deferral — no retryAt.
    if (req.coldOutbound && req.profileAllowsCold === false) {
      return {
        allow: false,
        code: 'PROFILE_NO_COLD',
        reason: 'SKIPPED: profile forbids cold outbound (inbound/referral leads only)',
        timezones: tzs,
      };
    }

    // TEST-ONLY determinism: the live flow suite (flows-live/e2e) exercises the
    // send PIPELINE, not quiet-hours (dispatchGate.test.ts covers that with an
    // injected clock). Wall-clock quiet hours made those flows fail whenever CI
    // ran after 9pm lead-local. DISPATCH_SKIP_QUIET_HOURS=1 skips ONLY the two
    // time gates (quiet hours + send window); DNC / flag / consent / demo /
    // numeric-guard / profile all still apply. Prod NEVER sets this env.
    const skipTimeGates = process.env.DISPATCH_SKIP_QUIET_HOURS === '1';

    // 4. Quiet hours 8am–9pm lead-local (all candidate zones).
    // Transactional sends (recipient-requested, e.g. OTP) skip time gates only.
    if (req.transactional || skipTimeGates) {
      return { allow: true, timezones: tzs };
    }
    if (!isWithinQuietHours(tzs, at)) {
      const retryAt = nextAllowed(at, (d) => isWithinQuietHours(tzs, d)) ?? undefined;
      return { allow: false, code: 'QUIET_HOURS', reason: 'Outside 8am-9pm lead-local', retryAt, timezones: tzs };
    }

    // 5. Send-window snapping — cadence steps only.
    if (req.isCadenceStep && !isWithinSendWindow(tzs, at)) {
      const retryAt =
        nextAllowed(at, (d) => isWithinSendWindow(tzs, d) && isWithinQuietHours(tzs, d)) ?? undefined;
      return { allow: false, code: 'OUTSIDE_WINDOW', reason: 'Outside 10-11am / 2-4pm lead-local', retryAt, timezones: tzs };
    }

    return { allow: true, timezones: tzs };
  } catch (error) {
    console.error('dispatchGate error (failing closed)', error);
    return { allow: false, code: 'DNC', reason: 'Gate error — failing closed', timezones: tzs };
  }
}
