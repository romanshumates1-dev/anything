/**
 * sesEvents — classify Amazon SES bounce/complaint notifications into
 * suppression decisions.
 *
 * WHY THIS IS ITS OWN PURE MODULE
 * Sender reputation is the email equivalent of carrier filtering: mail to a
 * dead address or to someone who hit "spam" degrades your deliverability for
 * EVERY future recipient, not just that one. So SES feedback must feed the
 * suppression store — but the classification is where the correctness lives,
 * and it is subtle enough to deserve isolation and exhaustive tests, separate
 * from the webhook plumbing that transports it.
 *
 * THE DISTINCTION THAT MATTERS: not every bounce should suppress.
 *   - Permanent bounce (bounceType 'Permanent')  -> the address is dead.
 *     Suppress. Continuing to mail it is what actually burns reputation.
 *   - Transient bounce ('Transient': mailbox full, message too large, a
 *     temporary DNS failure) -> the address is fine, the delivery wasn't.
 *     Do NOT suppress — that discards a reachable lead over a temporary
 *     condition, which is the opposite of the goal.
 *   - Complaint (any) -> the recipient marked it spam. Suppress immediately;
 *     a second complaint is far more expensive than a lost lead.
 *
 * SES's own guidance is that permanent bounces and complaints must be removed
 * from future sends; transient bounces should be retried, not suppressed. This
 * module encodes exactly that, and nothing more — the webhook decides what to
 * DO with the decision.
 */

export type SesEventType = 'Bounce' | 'Complaint' | 'Delivery' | 'Unknown';

export interface SuppressionDecision {
  eventType: SesEventType;
  /** Addresses that must be added to the opt-out store. */
  suppress: string[];
  /** Addresses seen but deliberately NOT suppressed (transient / delivery). */
  spared: string[];
  reason: string;
}

/** Lower-case + trim so the stored key matches what the send path looks up. */
function normEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const e = v.trim().toLowerCase();
  return e.includes('@') ? e : null;
}

/** Pull the email out of an SES recipient entry (bounce or complaint shape). */
function recipientEmails(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const r of list) {
    const e = normEmail((r as any)?.emailAddress);
    if (e) out.push(e);
  }
  return out;
}

/**
 * Classify one parsed SES notification object (the `Message` payload SNS wraps,
 * already JSON-parsed).
 *
 * Returns a decision even for shapes it does not recognise — an unknown event
 * suppresses nothing, so a new SES notification type can never accidentally
 * remove leads before this module is taught about it.
 */
export function classifySesEvent(msg: any): SuppressionDecision {
  const kind = msg?.eventType || msg?.notificationType;

  if (kind === 'Bounce' && msg?.bounce) {
    const type = msg.bounce.bounceType;
    const emails = recipientEmails(msg.bounce.bouncedRecipients);
    if (type === 'Permanent') {
      return {
        eventType: 'Bounce',
        suppress: emails,
        spared: [],
        reason: `permanent bounce (${msg.bounce.bounceSubType ?? 'unknown subtype'}) — address is dead`,
      };
    }
    // Transient / Undetermined: do not suppress. Undetermined is treated as
    // transient on purpose — suppressing on uncertainty loses reachable leads,
    // and a genuinely dead address will bounce Permanent soon enough.
    return {
      eventType: 'Bounce',
      suppress: [],
      spared: emails,
      reason: `${type ?? 'undetermined'} bounce — not suppressed (temporary or uncertain)`,
    };
  }

  if (kind === 'Complaint' && msg?.complaint) {
    const emails = recipientEmails(msg.complaint.complainedRecipients);
    return {
      eventType: 'Complaint',
      suppress: emails,
      spared: [],
      reason: 'complaint — recipient marked as spam, suppress immediately',
    };
  }

  if (kind === 'Delivery') {
    return { eventType: 'Delivery', suppress: [], spared: [], reason: 'delivery — no action' };
  }

  return {
    eventType: 'Unknown',
    suppress: [],
    spared: [],
    reason: `unrecognised SES event (${kind ?? 'no type'}) — no action`,
  };
}

/**
 * SNS envelope shapes we accept. SES delivers feedback wrapped in an SNS
 * message; the envelope's Type drives handling and is separate from the SES
 * eventType inside.
 */
export type SnsEnvelopeType = 'Notification' | 'SubscriptionConfirmation' | 'UnsubscribeConfirmation';

export interface ParsedSnsEnvelope {
  type: SnsEnvelopeType | 'Unknown';
  /** For Notification: the parsed SES message. */
  message: any;
  /** For SubscriptionConfirmation: the URL an OWNER must visit to confirm. */
  subscribeUrl?: string;
}

/**
 * Parse the SNS envelope without acting on it.
 *
 * SubscriptionConfirmation carries a SubscribeURL. It is deliberately NOT
 * fetched here: that URL arrives inside an untrusted webhook body, and
 * auto-visiting a URL supplied by observed content is exactly the class of
 * action that must stay a human decision. The URL is surfaced for the owner to
 * confirm; the handler never calls it.
 */
export function parseSnsEnvelope(body: any): ParsedSnsEnvelope {
  const type = body?.Type;
  if (type === 'Notification') {
    let message = body?.Message;
    if (typeof message === 'string') {
      try {
        message = JSON.parse(message);
      } catch {
        message = null;
      }
    }
    return { type: 'Notification', message };
  }
  if (type === 'SubscriptionConfirmation') {
    return { type: 'SubscriptionConfirmation', message: null, subscribeUrl: body?.SubscribeURL };
  }
  if (type === 'UnsubscribeConfirmation') {
    return { type: 'UnsubscribeConfirmation', message: null };
  }
  return { type: 'Unknown', message: null };
}
