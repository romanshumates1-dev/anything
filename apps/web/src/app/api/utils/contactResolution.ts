/**
 * contactResolution — how a sourced lead becomes reachable.
 *
 * WHY THIS EXISTS: skip-trace used to be a hard prerequisite. `sourced_leads`
 * carries no contact columns by design, so the only documented path from
 * "sourced" to "contactable" was a paid phone lookup — which made every
 * campaign gated on ~$0.05-0.15/record AND on A2P 10DLC registration, since a
 * phone's only high-volume channel is SMS.
 *
 * That was an architectural accident, not a requirement. A postal address is
 * ALREADY on every sourced lead (sourced_leads.mailing_address, straight from
 * the public record), and physical mail is reached by neither the TCPA nor
 * CAN-SPAM and needs no carrier registration. So the cheapest, most universal
 * resolver costs nothing and was sitting unused.
 *
 * This module makes resolution PLUGGABLE and skip-trace just one optional
 * plugin among several, ranked by cost and coverage. Callers ask for "a way to
 * reach this lead", not "a phone number".
 *
 * ROI IS MEASURED, NOT ASSUMED. Every attempt records cost and whether it
 * yielded a usable contact, so `resolverRoi()` can answer "is skip-trace
 * earning its money?" with data instead of vibes. A resolver that costs money
 * must justify it against the free ones or be switched off.
 */

export type ContactChannel = 'mail' | 'email' | 'phone';

export type ResolverId =
  | 'public-record-mailing' // free: already on the row
  | 'entity-lookup' // free: business filings for LLC-owned parcels
  | 'skip-trace'; // PAID, optional

export interface ResolvedContact {
  channel: ContactChannel;
  value: string;
  resolver: ResolverId;
  /** Cost in cents actually incurred to obtain this. Free resolvers report 0. */
  costCents: number;
}

export interface ResolverDescriptor {
  id: ResolverId;
  channel: ContactChannel;
  /** Typical cost per ATTEMPT (not per success) in cents. */
  costCentsPerAttempt: number;
  /** Requires no third party, no credentials, no spend. */
  free: boolean;
  /**
   * Does the channel this produces require carrier/campaign registration to
   * use at volume? This is the field that decides whether a resolver can be
   * part of a pre-A2P pipeline at all.
   */
  requiresCarrierRegistration: boolean;
  notes: string;
}

/**
 * Ordered cheapest-and-most-universal first. Order is the default resolution
 * strategy: stop at the first resolver that yields, so a paid lookup is only
 * ever reached when every free option has failed.
 */
export const RESOLVERS: ResolverDescriptor[] = [
  {
    id: 'public-record-mailing',
    channel: 'mail',
    costCentsPerAttempt: 0,
    free: true,
    requiresCarrierRegistration: false,
    notes:
      'sourced_leads.mailing_address, already populated from the public record. Universal coverage, zero cost, no TCPA/CAN-SPAM/10DLC exposure. The default.',
  },
  {
    id: 'entity-lookup',
    channel: 'email',
    costCentsPerAttempt: 0,
    free: true,
    requiresCarrierRegistration: false,
    notes:
      'For entity-owned parcels (LLC/trust/corp), the Secretary of State business filing is public and often carries a registered-agent email. B2B email under CAN-SPAM is the least-restricted outreach that exists. Partial coverage — only entity-owned rows.',
  },
  {
    id: 'skip-trace',
    channel: 'phone',
    costCentsPerAttempt: 10,
    free: false,
    requiresCarrierRegistration: true,
    notes:
      'OPTIONAL. Yields a phone, whose only high-volume channel is SMS — which requires A2P 10DLC registration. Paid AND registration-gated, so it is last by construction and must prove ROI against the free resolvers.',
  },
];

export function getResolver(id: ResolverId): ResolverDescriptor | undefined {
  return RESOLVERS.find((r) => r.id === id);
}

/**
 * Resolvers usable in a pipeline that must not depend on carrier registration.
 * This is the set an MVP runs on before (or instead of) A2P.
 */
export function registrationFreeResolvers(): ResolverDescriptor[] {
  return RESOLVERS.filter((r) => !r.requiresCarrierRegistration);
}

export interface SourcedLeadLike {
  mailing_address?: string | null;
  property_address?: string | null;
  owner_name?: string | null;
  /** Public-record business email, when an entity-lookup has populated it. */
  entity_email?: string | null;
}

/**
 * Detect an entity-owned parcel from the owner name. Entity-owned rows are the
 * ones where a free business-filing lookup can produce an email, and they are
 * over-represented in distressed/absentee inventory — which is why this is
 * worth branching on rather than defaulting everyone to a paid lookup.
 *
 * Conservative by design: a false positive only means we ATTEMPT a free
 * lookup, whereas a false negative silently pushes a lead toward paid
 * skip-trace. Erring toward "entity" costs nothing.
 */
export function looksLikeEntity(ownerName: string | null | undefined): boolean {
  if (!ownerName) return false;
  const n = ownerName.toUpperCase();
  return /\b(LLC|L\.L\.C|INC|CORP|CO|COMPANY|TRUST|LP|LLP|PARTNERS|HOLDINGS|PROPERTIES|ENTERPRISES|GROUP|ASSOCIATES|VENTURES|REALTY|ESTATE OF)\b/.test(
    n
  );
}

export interface ResolveOptions {
  /**
   * Allow PAID resolvers. Default FALSE — skip-trace is opt-in, never a silent
   * cost. A caller that wants a phone must ask for it explicitly.
   */
  allowPaid?: boolean;
  /** Restrict to channels the caller can actually send on today. */
  allowedChannels?: ContactChannel[];
}

/**
 * Resolve the cheapest usable contact for a lead.
 *
 * Returns every contact it could establish for free, plus a note on whether a
 * paid path exists. It never incurs cost unless `allowPaid` is set, and even
 * then only after the free resolvers have failed.
 */
export function resolveContacts(
  lead: SourcedLeadLike,
  opts: ResolveOptions = {}
): { contacts: ResolvedContact[]; paidAvailable: boolean; totalCostCents: number } {
  const allowed = opts.allowedChannels;
  const channelOk = (c: ContactChannel) => !allowed || allowed.includes(c);
  const contacts: ResolvedContact[] = [];

  // 1. Free + universal: the postal address already on the row.
  const mailing = (lead.mailing_address || lead.property_address || '').trim();
  if (mailing && channelOk('mail')) {
    contacts.push({
      channel: 'mail',
      value: mailing,
      resolver: 'public-record-mailing',
      costCents: 0,
    });
  }

  // 2. Free + partial: business-filing email for entity-owned parcels.
  const entityEmail = (lead.entity_email || '').trim();
  if (entityEmail && channelOk('email')) {
    contacts.push({ channel: 'email', value: entityEmail, resolver: 'entity-lookup', costCents: 0 });
  }

  // 3. Paid: only when explicitly permitted AND nothing free worked. Note this
  // function does not PERFORM the lookup (that is I/O); it reports that the
  // option exists, so the caller can decide with the cost in front of them.
  const paidAvailable =
    channelOk('phone') && looksLikeEntity(lead.owner_name) === false && contacts.length === 0;

  return {
    contacts,
    paidAvailable,
    totalCostCents: contacts.reduce((s, c) => s + c.costCents, 0),
  };
}

export interface ResolverAttemptStat {
  resolver: ResolverId;
  attempts: number;
  hits: number;
  costCents: number;
}

export interface ResolverRoi extends ResolverAttemptStat {
  hitRate: number;
  /** Cost per USABLE contact, not per attempt — the number that decides spend. */
  costPerHitCents: number | null;
}

/**
 * Turn raw attempt counters into the decision-grade number: cost per usable
 * contact. A resolver with a 90% hit rate at 10c is worse than one with a 30%
 * hit rate at 1c, and only this view shows that.
 *
 * Returns costPerHitCents: null on zero hits rather than Infinity — an
 * un-evaluable resolver must not sort as "infinitely expensive" next to real
 * measurements; the caller should treat null as "no data yet".
 */
export function resolverRoi(stats: ResolverAttemptStat[]): ResolverRoi[] {
  return stats.map((s) => ({
    ...s,
    hitRate: s.attempts > 0 ? s.hits / s.attempts : 0,
    costPerHitCents: s.hits > 0 ? s.costCents / s.hits : null,
  }));
}

/**
 * Is a paid resolver earning its place against the best free alternative?
 *
 * `freeCoverage` is the fraction of leads the free resolvers already make
 * reachable. Paid spend is only justified for the REMAINDER — buying phones
 * for leads you can already mail is spending money to add a channel that also
 * needs A2P registration.
 */
export function paidResolverJustified(opts: {
  freeCoverage: number;
  paidCostPerHitCents: number | null;
  /** What a deal is worth, to compare against. */
  expectedValuePerContactCents: number;
}): { justified: boolean; reason: string } {
  const { freeCoverage, paidCostPerHitCents, expectedValuePerContactCents } = opts;

  if (paidCostPerHitCents === null) {
    return { justified: false, reason: 'no paid-resolver data yet — cannot justify spend on zero measurements' };
  }
  if (freeCoverage >= 0.95) {
    return {
      justified: false,
      reason: `free resolvers already reach ${(freeCoverage * 100).toFixed(1)}% of leads; paid spend buys a channel that additionally requires carrier registration`,
    };
  }
  if (paidCostPerHitCents >= expectedValuePerContactCents) {
    return {
      justified: false,
      reason: `cost per usable contact (${paidCostPerHitCents}c) meets or exceeds expected value per contact (${expectedValuePerContactCents}c)`,
    };
  }
  return {
    justified: true,
    reason: `cost per usable contact (${paidCostPerHitCents}c) is below expected value (${expectedValuePerContactCents}c) and free coverage is only ${(freeCoverage * 100).toFixed(1)}%`,
  };
}
