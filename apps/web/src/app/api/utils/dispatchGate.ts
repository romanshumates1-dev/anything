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
 *   1.5 DNC registry      — federal/state list + 31-day Safe Harbor freshness,
 *                           COLD OUTBOUND ONLY (migration 043)
 *   2. beta flag          — an OFF integration must emit zero events
 *   3. consentBasis       — voice/RVM only (TCPA prior-express-consent posture)
 *   3.2 SMS consent       — cold SMS under sms_consent_policy='required'
 *   4. quiet hours        — 8am-9pm LEAD-LOCAL
 *   5. send-window snap   — cadence steps only (10-11am / 2-4pm lead-local)
 *
 * WHY 1.5 AND 3.2 ARE COLD-OUTBOUND-ONLY: the National DNC Registry and TCPA
 * prior-express-consent both govern SOLICITATIONS. A reply inside a
 * conversation the consumer started is not a solicitation, and an
 * established-business-relationship reply must not be suppressed by a registry
 * listing — doing so would break every inbound thread. Internal opt-out (step
 * 1) has no such carve-out: STOP means stop, on every channel, forever.
 *
 * EMAIL IS A DIFFERENT STATUTE, NOT A FOURTH PHONE CHANNEL.
 * Email is governed by CAN-SPAM (15 U.S.C. 7701), the TCPA does not reach it,
 * and applying telephony rules to it would be both wrong and needlessly
 * restrictive. For channel==='email' this gate applies EXACTLY ONE rule —
 * opt-out suppression (step 1), because honouring an unsubscribe is CAN-SPAM's
 * central duty (and its 10-business-day deadline is why we suppress
 * immediately rather than on a schedule). Everything else is skipped, on
 * purpose:
 *   - DNC registry            — a TELEPHONE registry; meaningless for email.
 *   - sms_consent_policy      — SMS-specific by construction.
 *   - quiet hours / windows   — TCPA time-of-day limits apply to calls/texts,
 *                               not email.
 *   - consentBasis            — CAN-SPAM is opt-OUT, not opt-in: prior consent
 *                               is NOT required to send. This is precisely why
 *                               email is testable today while 10DLC is pending.
 * What CAN-SPAM does require lives at the composition layer, not here: a
 * functioning unsubscribe, a real physical postal address, non-deceptive
 * headers and subject lines. The email driver owns those.
 *
 * MAIL IS THE LEAST-REGULATED CHANNEL, AND THE ONLY UNIVERSAL SELLER REACH.
 * Physical mail is not a "call" (TCPA does not reach it), not "electronic mail"
 * (CAN-SPAM does not reach it), and carries no carrier/registration layer at
 * all — no 10DLC, no A2P, no campaign approval. So this gate applies exactly
 * one rule to it, the same one email gets: internal opt-out suppression.
 *
 * That is honoured even though no federal statute compels it here, because a
 * recipient who has told us to stop has told us to stop, and several states run
 * their own do-not-mail / solicitation rules. Suppression is cheap; a
 * complaint is not.
 *
 * Operationally this is the channel that satisfies "reach sellers at volume
 * without carrier registration": sourced_leads.mailing_address comes straight
 * from the public record, so EVERY sourced lead is mail-reachable with no
 * skip-trace, no enrichment, and no per-record cost before the send itself.
 *
 * The suppression TARGET differs by channel: `phone` for telephony, `email`
 * for email, `mailingAddress` for mail. Sending to the wrong key would fail
 * OPEN, so it is resolved once, explicitly, at the top of the gate.
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

export type DispatchChannel = 'sms' | 'voice' | 'rvm' | 'email' | 'mail';

/**
 * Telephony channels. Email is governed by CAN-SPAM (15 U.S.C. 7701), a
 * fundamentally different statute from the TCPA — so nearly every rule in this
 * gate is telephony-only and email takes an explicit, narrow path. See the
 * EMAIL note in the header docblock for exactly which rules apply.
 */
export const TELEPHONY_CHANNELS: DispatchChannel[] = ['sms', 'voice', 'rvm'];
export const isTelephony = (c: DispatchChannel): boolean => TELEPHONY_CHANNELS.includes(c);

/** Consent bases that permit an automated voice/RVM touch. Anything else = skip. */
export const VALID_CONSENT_BASES = ['manual-list-attested', 'inbound-initiated'] as const;
export type ConsentBasis = (typeof VALID_CONSENT_BASES)[number];

export const QUIET_HOURS = { startHour: 8, endHour: 21 } as const; // 8am–9pm inclusive-exclusive
export const SEND_WINDOWS = [
  { startHour: 10, endHour: 11 },
  { startHour: 14, endHour: 16 },
] as const;

export type DenyCode =
  | 'DNC'              // internal opt-out (someone texted STOP to us) — absolute
  | 'DNC_REGISTRY'     // on the federal/state Do-Not-Call registry
  | 'DNC_STALE'        // registry coverage for this NPA is missing or >31 days old
  | 'FLAG_OFF'
  | 'NO_CONSENT'
  | 'QUIET_HOURS'
  | 'OUTSIDE_WINDOW'
  | 'PROFILE_NO_COLD'
  | 'NUMERIC_GUARD'
  | 'DEMO_NOT_VERIFIED'
  | 'USAGE_LIMIT';

export type DispatchDecision =
  | { allow: true; timezones: string[] }
  | { allow: false; code: DenyCode; reason: string; retryAt?: Date; timezones: string[] };

export interface DispatchRequest {
  /**
   * Lead phone — drives DNC lookup and lead-local timezone. Required for the
   * telephony channels; ignored when channel==='email' (pass '' there).
   */
  phone: string;
  /**
   * Recipient address. REQUIRED when channel==='email' — it is the suppression
   * key, and looking up the wrong key would fail OPEN (we would send to
   * someone who unsubscribed), so the gate denies outright when it is missing
   * rather than falling back to `phone`.
   */
  email?: string | null;
  /**
   * Deliverable postal address. REQUIRED when channel==='mail' — it is the
   * suppression key for that channel, same fail-closed rule as `email`.
   *
   * Note this needs NO enrichment: sourced_leads.mailing_address is populated
   * by both parsers straight from the public record, which is what makes
   * direct mail reachable without skip trace.
   */
  mailingAddress?: string | null;
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
   * Owning org, used ONLY to resolve per-org send policy (sms_consent_policy,
   * dnc_enforcement — migration 043).
   *
   * Deliberately OPTIONAL: making it required would have meant editing every
   * existing call site in the same change that introduces the DNC checks, which
   * is exactly how a safety-critical gate acquires a silent regression. When it
   * is absent the DNC *presence* check still runs (it needs no policy), and
   * only the two TIGHTENING behaviours are skipped — 'strict' staleness denial
   * and 'required' per-number SMS consent. See getOrgSendPolicy().
   */
  organizationId?: string | null;
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

/**
 * True if this target has EVER opted out on ANY channel (STOP suppresses
 * everything, permanently).
 *
 * `target` is a phone for telephony and an email address for email — the
 * lookup is deliberately channel-agnostic so an unsubscribe recorded against
 * one identifier keeps suppressing it everywhere it appears.
 */
export async function isSuppressed(target: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM compliance_records
    WHERE target = ${target} AND type = 'opt-out'
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
    // ── NON-TELEPHONY (email, mail). Neither is reached by the TCPA, so every
    // telephony rule below is skipped rather than merely inapplicable. See the
    // EMAIL and MAIL notes in the header docblock.
    if (!isTelephony(req.channel)) {
      const target =
        req.channel === 'email' ? (req.email ?? '').trim() : (req.mailingAddress ?? '').trim();
      if (!target) {
        // Fail CLOSED. Falling back to `phone` here would look up the wrong
        // suppression key and happily send to someone who opted out.
        return {
          allow: false,
          code: 'NO_CONSENT',
          reason:
            req.channel === 'email'
              ? 'SKIPPED: email channel requires an email address (suppression key)'
              : 'SKIPPED: mail channel requires a mailing address (suppression key)',
          timezones: tzs,
        };
      }
      if (await isSuppressed(target)) {
        return {
          allow: false,
          code: 'DNC',
          reason:
            req.channel === 'email'
              ? 'Recipient unsubscribed (CAN-SPAM opt-out honoured on all channels)'
              : 'Recipient opted out of mail (honoured on all channels)',
          timezones: tzs,
        };
      }
      // An OFF integration must still emit zero events.
      if (req.betaFlag && !(await isBetaFlagOn(req.betaFlag))) {
        return { allow: false, code: 'FLAG_OFF', reason: `Beta flag ${req.betaFlag} is off`, timezones: tzs };
      }
      return { allow: true, timezones: tzs };
    }

    // 1. DNC / opt-out — absolute, every channel, permanent.
    if (await isSuppressed(req.phone)) {
      return { allow: false, code: 'DNC', reason: 'Recipient opted out (suppressed on all channels)', timezones: tzs };
    }

    // 1.5 DNC REGISTRY (federal/state) + Safe Harbor freshness.
    // Cold outbound only — see the header note on why replies are exempt.
    // Runs BEFORE the beta-flag check because a registry listing is a fact about
    // the recipient, not a feature toggle: we want the deny reason to say "on
    // the DNC list", not "flag off", when both are true.
    if (req.coldOutbound) {
      const { checkDncRegistry, isAreaCoverageFresh, getOrgSendPolicy, SAFE_HARBOR_DAYS } =
        await import('./dncRegistry');
      const policy = await getOrgSendPolicy(req.organizationId);

      if (policy.dncEnforcement !== 'off') {
        // Presence check needs no policy and is never wrong to enforce.
        const hit = await checkDncRegistry(req.phone);
        if (hit.listed) {
          const where = hit.jurisdiction ? `${hit.source}/${hit.jurisdiction}` : hit.source;
          return {
            allow: false,
            code: 'DNC_REGISTRY',
            reason: `Recipient is on the ${where} Do-Not-Call registry`,
            timezones: tzs,
          };
        }

        // Freshness only bites in 'strict'. A snapshot older than 31 days (or
        // absent) confers NO safe harbour under 16 CFR 310.4(b)(3)(iv), so a
        // "not listed" answer derived from it is not defensible — strict mode
        // therefore refuses to rely on it rather than sending on stale data.
        if (policy.dncEnforcement === 'strict') {
          const cov = await isAreaCoverageFresh(req.phone, at);
          if (!cov.fresh) {
            const detail =
              cov.lastFetchedAt === null
                ? 'no registry coverage imported for this area code'
                : `registry coverage is ${Math.floor(cov.ageDays ?? 0)} days old (limit ${SAFE_HARBOR_DAYS})`;
            return {
              allow: false,
              code: 'DNC_STALE',
              reason: `SKIPPED: ${detail} — Safe Harbor requires a scrub within ${SAFE_HARBOR_DAYS} days`,
              timezones: tzs,
            };
          }
        }
      }
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

    // 3.2 SMS OPT-IN. Only for a COLD first-touch, and only when the org has
    // opted into the consent-first posture (sms_consent_policy='required').
    // Under 'attested' the operator asserts a lawful basis for the list itself
    // and this check is skipped — that is the cold-outreach posture and it
    // carries the TCPA/carrier exposure documented in AWS_CREDITS_PLAN.md.
    // Accepted proof is a recorded consent (compliance_records type='consent');
    // an 'unverified' contact list is explicitly NOT proof.
    if (req.channel === 'sms' && req.coldOutbound) {
      const { getOrgSendPolicy, hasSmsConsent } = await import('./dncRegistry');
      const policy = await getOrgSendPolicy(req.organizationId);
      if (policy.smsConsentPolicy === 'required' && !(await hasSmsConsent(req.phone))) {
        return {
          allow: false,
          code: 'NO_CONSENT',
          reason:
            'SKIPPED: no recorded SMS consent for a cold first-touch (org policy sms_consent_policy=required)',
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
