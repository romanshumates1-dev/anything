/**
 * emailDriver — CAN-SPAM-enforcing outbound email.
 *
 * WHY THIS EXISTS SEPARATELY FROM messaging.ts
 * Email is the only outbound channel that needs NO carrier registration and NO
 * prior consent, so it is the one that can run while A2P 10DLC is pending. But
 * CAN-SPAM (15 U.S.C. 7704) imposes composition duties the TCPA does not, and
 * they are enforced at the point a message is built — not at the gate, which
 * only knows about the recipient. This module is that enforcement point.
 *
 * THE GUARD IS THE POINT, exactly as numericGuard is for bounded negotiation.
 * A send missing an unsubscribe mechanism or a physical postal address is a
 * statutory violation ($53,088 per email under the FTC's inflation-adjusted
 * maximum), so it is structurally impossible here: canSpamGuard REFUSES and
 * the message is never handed to a provider. Making it a lint rule or a code
 * review item would be a guarantee only until someone forgets.
 *
 * PROVIDER SEAM, NOT A PROVIDER. Mirrors messaging.ts's SMS_PROVIDER_URL: when
 * EMAIL_PROVIDER_URL is unset delivery is simulated and recorded as `mock`;
 * when set, the same path POSTs there. Deliberately no AWS SDK dependency —
 * point EMAIL_PROVIDER_URL at a small Lambda fronting SES and the credits pay
 * for the send, with no new package in the lockfile and no vendor coupling in
 * this file.
 */
import { dispatchGate, type DenyCode } from '@/app/api/utils/dispatchGate';
import { getEmailCircuitBreaker } from '@/app/api/utils/channelCircuitBreaker';

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain-text or HTML body. The unsubscribe URL must appear inside it. */
  body: string;
  /** CAN-SPAM 7704(a)(3): a functioning opt-out mechanism. */
  unsubscribeUrl: string;
  /** CAN-SPAM 7704(a)(5)(A)(iii): a valid physical postal address. */
  postalAddress: string;
  organizationId?: string | null;
  campaignId?: string | null;
  contactId?: string | null;
  leadId?: number | null;
  /** First-touch to someone who has not contacted us. */
  coldOutbound?: boolean;
  /** Injectable clock for tests. */
  now?: Date;
}

export type EmailSendResult =
  | { status: 'dispatched'; provider: 'mock' | 'provider'; providerId?: string }
  | { status: 'suppressed'; gateCode: DenyCode; reason: string }
  | { status: 'blocked'; reason: string }
  | { status: 'failed'; errorMessage: string };

export type GuardVerdict = { ok: true } | { ok: false; reason: string };

/** Deliberately permissive shape check — we are rejecting obvious garbage, not validating deliverability. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * CAN-SPAM composition guard. Every failure here is a statutory violation, not
 * a style problem, so each returns a specific reason rather than a boolean —
 * an operator needs to know WHICH duty was unmet.
 */
export function canSpamGuard(msg: EmailMessage): GuardVerdict {
  if (!msg.to || !EMAIL_RE.test(msg.to.trim())) {
    return { ok: false, reason: `invalid recipient address: ${JSON.stringify(msg.to)}` };
  }

  // 7704(a)(2): deceptive subject headings are prohibited. An EMPTY subject is
  // the degenerate case — it tells the recipient nothing about the message.
  if (!msg.subject || !msg.subject.trim()) {
    return { ok: false, reason: 'missing subject (CAN-SPAM 7704(a)(2): no deceptive/absent subject)' };
  }

  if (!msg.body || !msg.body.trim()) {
    return { ok: false, reason: 'missing body' };
  }

  // 7704(a)(3): a functioning return address or internet-based opt-out.
  const unsub = (msg.unsubscribeUrl ?? '').trim();
  if (!unsub) {
    return { ok: false, reason: 'missing unsubscribe URL (CAN-SPAM 7704(a)(3))' };
  }
  if (!/^https?:\/\//i.test(unsub)) {
    return { ok: false, reason: `unsubscribe URL must be http(s): ${JSON.stringify(unsub)}` };
  }
  // Present in the object but absent from the body is the failure that looks
  // compliant in code review and is not compliant in the inbox.
  if (!msg.body.includes(unsub)) {
    return { ok: false, reason: 'unsubscribe URL is not present in the body' };
  }

  // 7704(a)(5)(A)(iii): valid physical postal address of the sender.
  const postal = (msg.postalAddress ?? '').trim();
  if (!postal) {
    return { ok: false, reason: 'missing physical postal address (CAN-SPAM 7704(a)(5)(A)(iii))' };
  }
  if (!msg.body.includes(postal)) {
    return { ok: false, reason: 'physical postal address is not present in the body' };
  }

  return { ok: true };
}

/**
 * Send one email. Order is deliberate and mirrors the SMS transmit hop:
 *   1. CAN-SPAM composition guard — cheapest, and a failure is never retryable
 *      as-is, so it must not consume a gate lookup or a provider call.
 *   2. dispatchGate (channel 'email') — suppression. See dispatchGate's EMAIL
 *      note: opt-out is the ONLY rule that applies to this channel.
 *   3. Provider (or mock).
 *
 * Never returns 'dispatched' without either a real provider 2xx or an explicit
 * mock path — same discipline as sendMessage.
 */
export async function sendEmail(msg: EmailMessage): Promise<EmailSendResult> {
  const guard = canSpamGuard(msg);
  if (!guard.ok) {
    return { status: 'blocked', reason: `CAN-SPAM: ${guard.reason}` };
  }

  const decision = await dispatchGate({
    phone: '',
    email: msg.to,
    channel: 'email',
    coldOutbound: msg.coldOutbound ?? true,
    organizationId: msg.organizationId ?? null,
    now: msg.now,
  });
  if (!decision.allow) {
    return { status: 'suppressed', gateCode: decision.code, reason: decision.reason };
  }

  const providerUrl = process.env.EMAIL_PROVIDER_URL;
  if (!providerUrl) {
    return { status: 'dispatched', provider: 'mock' };
  }

  // Phase 0B: circuit breaker — one channel failing must not crash others.
  const breaker = getEmailCircuitBreaker();
  if (!breaker.canAttempt()) {
    return { status: 'failed', errorMessage: 'email circuit breaker OPEN — provider temporarily unavailable' };
  }

  const apiKey = process.env.EMAIL_PROVIDER_API_KEY;
  const fromAddress = process.env.EMAIL_FROM_ADDRESS;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  try {
    const res = await fetch(providerUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        from: fromAddress || undefined,
        to: msg.to,
        subject: msg.subject,
        text: msg.body,
        reply_to: process.env.EMAIL_REPLY_TO || undefined,
        headers: {
          'List-Unsubscribe': `<${msg.unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      breaker.recordFailure();
      return { status: 'failed', errorMessage: `email provider responded [${res.status}]` };
    }
    const respBody = await res.json().catch(() => ({}) as any);
    breaker.recordSuccess();
    return { status: 'dispatched', provider: 'provider', providerId: respBody?.id || respBody?.messageId };
  } catch (error: any) {
    breaker.recordFailure();
    return { status: 'failed', errorMessage: error?.message ?? String(error) };
  }
}

/**
 * Append the CAN-SPAM footer to a body that does not already carry it.
 *
 * Exists so callers cannot accidentally compose a non-compliant message: build
 * the body, run it through here, and the guard above will pass. Idempotent —
 * calling it twice does not duplicate the footer.
 */
export function withCanSpamFooter(
  body: string,
  opts: { unsubscribeUrl: string; postalAddress: string }
): string {
  const hasUnsub = body.includes(opts.unsubscribeUrl);
  const hasPostal = body.includes(opts.postalAddress);
  if (hasUnsub && hasPostal) return body;

  const parts = [body.trimEnd(), '', '---'];
  if (!hasUnsub) parts.push(`Unsubscribe: ${opts.unsubscribeUrl}`);
  if (!hasPostal) parts.push(opts.postalAddress);
  return parts.join('\n');
}
