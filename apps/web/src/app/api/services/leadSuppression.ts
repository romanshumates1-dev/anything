/**
 * leadSuppression — one opt-out kills every channel for that PERSON.
 *
 * THE GAP THIS CLOSES
 * dispatchGate.isSuppressed() is keyed on a TARGET (a phone, an email address,
 * a postal address) and is channel-agnostic — so one row denies sms AND voice
 * AND rvm for that identifier. That is correct but insufficient: a person is
 * not an identifier. An email unsubscribe wrote a row for the ADDRESS, so the
 * same lead's PHONE stayed reachable and SMS kept sending.
 *
 * Verified live before this module existed (scripts/verify-cross-channel-optout.mjs,
 * LEG 3): the mechanism suppressed every channel for the identifier it was
 * given, and nothing else. That is the exact shape of a compliance failure that
 * looks fine in a unit test — the assertion passes, the wrong person keeps
 * getting texted.
 *
 * So an opt-out arriving on ANY channel fans out to EVERY identifier we hold
 * for that lead. Fan-out happens at WRITE time, not read time, deliberately:
 *   - the send path stays a single indexed lookup (it runs per message)
 *   - the suppression is a durable record, auditable after the fact, and
 *     survives the lead row later being edited or its email being cleared
 * A read-time join would make every send pay for a lookup that changes only
 * when someone opts out, and would silently un-suppress if the linking column
 * were ever nulled.
 */
import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';

export type OptOutChannel = 'sms' | 'email' | 'mail' | 'voice' | 'rvm' | 'manual';

export interface SuppressionResult {
  leadId: number | null;
  /** Every identifier that now carries an opt-out row. */
  suppressed: string[];
  /** Identifiers already suppressed before this call. */
  alreadySuppressed: string[];
}

/** Normalise a phone to the E.164 form the rest of the system stores. */
function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  const nsn = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (nsn.length !== 10) return null;
  return `+1${nsn}`;
}

function normalizeEmail(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().toLowerCase();
  return v.includes('@') ? v : null;
}

/**
 * Every identifier we can reach a lead by. Order is irrelevant — all are
 * suppressed — but the set must be COMPLETE, because anything missed stays
 * reachable and that is the whole failure mode.
 */
export function identifiersForLead(lead: {
  phone?: string | null;
  email?: string | null;
  metadata?: any;
}): string[] {
  const out = new Set<string>();
  const phone = normalizePhone(lead.phone);
  if (phone) out.add(phone);
  const email = normalizeEmail(lead.email);
  if (email) out.add(email);

  const meta = lead.metadata ?? {};
  const mailing = (meta.mailing_address ?? '').toString().trim();
  if (mailing) out.add(mailing);
  // property_address is deliberately EXCLUDED: it is where the house is, not
  // where the owner receives mail. Suppressing it would block a different
  // owner at the same parcel after a sale.
  return Array.from(out);
}

/**
 * Find the lead that owns an identifier. Checks phone and email columns, plus
 * the mailing address in metadata, so an opt-out arriving on any channel can be
 * traced back to the person.
 */
export async function findLeadByIdentifier(identifier: string): Promise<
  { id: number; phone: string | null; email: string | null; metadata: any } | null
> {
  const raw = (identifier ?? '').trim();
  if (!raw) return null;
  const phone = normalizePhone(raw);
  const email = normalizeEmail(raw);

  const rows = await sql`
    SELECT id, phone, email, metadata
    FROM leads
    WHERE (${phone}::text IS NOT NULL AND phone = ${phone})
       OR (${email}::text IS NOT NULL AND LOWER(email) = ${email})
       OR (metadata->>'mailing_address') = ${raw}
    ORDER BY id ASC
    LIMIT 1
  `;
  return (rows[0] as any) ?? null;
}

/**
 * Record an opt-out and fan it out across every identifier for that lead.
 *
 * Always suppresses the identifier it was handed, even when no lead matches —
 * an unsubscribe from someone we cannot resolve must still be honoured. Failing
 * to find a lead is not a reason to keep sending.
 */
export async function suppressLeadAllChannels(opts: {
  identifier: string;
  channel: OptOutChannel;
  reason?: string;
  actorUserId?: string | null;
}): Promise<SuppressionResult> {
  const identifier = (opts.identifier ?? '').trim();
  if (!identifier) return { leadId: null, suppressed: [], alreadySuppressed: [] };

  const lead = await findLeadByIdentifier(identifier);

  // The handed identifier is always included, normalised where possible so the
  // stored key matches what dispatchGate will look up at send time.
  const targets = new Set<string>([
    normalizePhone(identifier) ?? normalizeEmail(identifier) ?? identifier,
  ]);
  if (lead) for (const id of identifiersForLead(lead)) targets.add(id);

  const existing = await sql`
    SELECT DISTINCT target FROM compliance_records
    WHERE type = 'opt-out' AND target = ANY(${Array.from(targets)})
  `;
  const already = new Set((existing as Array<{ target: string }>).map((r) => r.target));

  const suppressed: string[] = [];
  for (const target of targets) {
    await sql`
      INSERT INTO compliance_records (target, type, channel, metadata)
      VALUES (${target}, 'opt-out', ${opts.channel}, ${JSON.stringify({
        reason: opts.reason ?? 'opt-out',
        originIdentifier: identifier,
        leadId: lead?.id ?? null,
        fannedOut: target !== identifier,
      })})
      ON CONFLICT (target, channel, type) DO UPDATE SET created_at = CURRENT_TIMESTAMP
    `;
    suppressed.push(target);
  }

  await logEvent(
    'lead_suppressed_all_channels',
    'compliance',
    String(lead?.id ?? identifier),
    { channel: opts.channel, identifiers: suppressed.length, leadId: lead?.id ?? null },
    opts.actorUserId ?? undefined
  );

  return {
    leadId: lead?.id ?? null,
    suppressed,
    alreadySuppressed: Array.from(already),
  };
}
