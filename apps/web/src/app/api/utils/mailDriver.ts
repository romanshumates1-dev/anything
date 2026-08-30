/**
 * mailDriver — direct-mail outbound. The registration-free seller channel.
 *
 * WHY THIS IS THE PRIMARY MVP CHANNEL
 * Physical mail is not a "call" (TCPA does not reach it), not "electronic mail"
 * (CAN-SPAM does not reach it), and has no carrier layer at all — no 10DLC, no
 * A2P, no campaign approval, no throughput tier. It is the only channel that
 * reaches sellers at volume with zero registration and zero contact enrichment,
 * because sourced_leads.mailing_address is already populated from the public
 * record.
 *
 * WHAT MAKES ITS GUARD DIFFERENT FROM EMAIL'S
 * canSpamGuard exists because a non-compliant email is a STATUTORY violation.
 * Mail has no equivalent federal duty — its guard exists because every piece
 * costs real money (~45-70c). An undeliverable address is not a compliance
 * event, it is silently burnt budget, and at 10,000 pieces a 5% bad-address
 * rate is ~$250-350 gone with no signal to show for it. So the guard here is
 * about DELIVERABILITY, and it fails closed for the same reason: the cheapest
 * piece is the one never printed.
 *
 * PROVIDER SEAM, NOT A PROVIDER. Mirrors emailDriver's EMAIL_PROVIDER_URL and
 * messaging.ts's SMS_PROVIDER_URL: unset -> simulated and reported as `mock`,
 * never as a real send; set -> POSTs there. Works with Lob / PostGrid /
 * Click2Mail / a Lambda, with no vendor coupling in this file and nothing new
 * in the lockfile.
 */
import { dispatchGate, type DenyCode } from '@/app/api/utils/dispatchGate';

export interface MailPiece {
  /** Deliverable postal address, as held on sourced_leads.mailing_address. */
  to: string;
  /** Recipient name for the address block. */
  toName?: string | null;
  /** Body copy. Provider decides postcard/letter rendering. */
  body: string;
  /** Sender return address — required by every mail provider, and by USPS. */
  returnAddress: string;
  organizationId?: string | null;
  campaignId?: string | null;
  contactId?: string | null;
  leadId?: number | null;
  /** Cost of one piece in cents, for spend tracking. */
  unitCostCents?: number;
  now?: Date;
}

export type MailSendResult =
  | { status: 'dispatched'; provider: 'mock' | 'provider'; providerId?: string; costCents: number }
  | { status: 'suppressed'; gateCode: DenyCode; reason: string }
  | { status: 'blocked'; reason: string }
  | { status: 'failed'; errorMessage: string };

export type MailGuardVerdict = { ok: true } | { ok: false; reason: string };

/** Default assumed unit cost when the caller does not supply one (postcard-ish). */
export const DEFAULT_UNIT_COST_CENTS = 55;

/** US ZIP, 5 or ZIP+4. */
const ZIP_RE = /\b\d{5}(-\d{4})?\b/;
/** Two-letter state, as its own token. */
const STATE_RE = /\b[A-Z]{2}\b/;

/**
 * Deliverability guard. NOT a compliance check — a spend check.
 *
 * Deliberately structural rather than a full CASS/address-verification pass:
 * that is the mail provider's job and they do it better. This catches the
 * failures that are obvious for free — an address with no ZIP, no state, or
 * effectively no street line will never deliver, and paying to print it is
 * pure waste.
 */
export function mailAddressGuard(piece: MailPiece): MailGuardVerdict {
  const to = (piece.to ?? '').trim();
  if (!to) return { ok: false, reason: 'missing recipient address' };
  if (to.length < 10) {
    return { ok: false, reason: `recipient address is too short to be deliverable: ${JSON.stringify(to)}` };
  }
  const upper = to.toUpperCase();
  if (!ZIP_RE.test(upper)) {
    return { ok: false, reason: 'recipient address has no ZIP code' };
  }
  if (!STATE_RE.test(upper)) {
    return { ok: false, reason: 'recipient address has no 2-letter state' };
  }
  // A street line needs at least one digit (house/box number). "KY 40202" alone
  // is a city/state/ZIP with nothing to deliver to.
  if (!/\d/.test(to.replace(ZIP_RE, ''))) {
    return { ok: false, reason: 'recipient address has no street/box number' };
  }

  if (!piece.body || !piece.body.trim()) return { ok: false, reason: 'missing body copy' };

  const ret = (piece.returnAddress ?? '').trim();
  if (!ret) return { ok: false, reason: 'missing return address (required by USPS and every provider)' };

  return { ok: true };
}

/**
 * Send one piece. Order mirrors the other drivers:
 *   1. Deliverability guard — cheapest, never retryable as-is, and the whole
 *      point is to fail before spending.
 *   2. dispatchGate (channel 'mail') — internal opt-out suppression, the only
 *      rule that applies to this channel.
 *   3. Provider (or mock).
 *
 * Never reports 'dispatched' without a provider 2xx or an explicit mock path.
 */
export async function sendMail(piece: MailPiece): Promise<MailSendResult> {
  const guard = mailAddressGuard(piece);
  if (!guard.ok) {
    return { status: 'blocked', reason: `undeliverable: ${guard.reason}` };
  }

  const decision = await dispatchGate({
    phone: '',
    mailingAddress: piece.to,
    channel: 'mail',
    coldOutbound: true,
    organizationId: piece.organizationId ?? null,
    now: piece.now,
  });
  if (!decision.allow) {
    return { status: 'suppressed', gateCode: decision.code, reason: decision.reason };
  }

  const costCents = piece.unitCostCents ?? DEFAULT_UNIT_COST_CENTS;
  const providerUrl = process.env.MAIL_PROVIDER_URL;
  if (!providerUrl) {
    // Mock path — explicit, and cost is still reported so a dry run produces a
    // real budget estimate before any money is committed.
    return { status: 'dispatched', provider: 'mock', costCents };
  }

  try {
    const res = await fetch(providerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: piece.to,
        toName: piece.toName ?? null,
        body: piece.body,
        returnAddress: piece.returnAddress,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      return { status: 'failed', errorMessage: `mail provider responded [${res.status}]` };
    }
    const body = await res.json().catch(() => ({}) as any);
    return { status: 'dispatched', provider: 'provider', providerId: body?.id, costCents };
  } catch (error: any) {
    return { status: 'failed', errorMessage: error?.message ?? String(error) };
  }
}

/**
 * Budget a campaign BEFORE committing spend.
 *
 * Mail is the one channel where volume converts directly to dollars, so a
 * caller must be able to see the bill before printing. Returns the guard-passing
 * count too — budgeting on raw row count would over-state the spend and, worse,
 * hide that some rows were never mailable.
 */
export function estimateMailCampaign(
  pieces: MailPiece[],
  unitCostCents: number = DEFAULT_UNIT_COST_CENTS
): { mailable: number; undeliverable: number; totalCostCents: number; totalCostUsd: number } {
  let mailable = 0;
  let undeliverable = 0;
  for (const p of pieces) {
    if (mailAddressGuard(p).ok) mailable++;
    else undeliverable++;
  }
  const totalCostCents = mailable * (unitCostCents ?? DEFAULT_UNIT_COST_CENTS);
  return {
    mailable,
    undeliverable,
    totalCostCents,
    totalCostUsd: Math.round(totalCostCents) / 100,
  };
}
