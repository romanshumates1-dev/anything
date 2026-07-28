/**
 * contactResolution — skip-trace is OPTIONAL, and its ROI is measured.
 *
 * The property under test is the architectural one: a sourced lead must be
 * reachable with ZERO spend and ZERO carrier registration. Skip-trace used to
 * be a hard prerequisite, which silently coupled every campaign to both a
 * per-record cost and A2P 10DLC (a phone's only volume channel is SMS).
 */
import { describe, it, expect } from 'vitest';
import {
  RESOLVERS,
  getResolver,
  registrationFreeResolvers,
  looksLikeEntity,
  resolveContacts,
  resolverRoi,
  paidResolverJustified,
} from '../contactResolution';

describe('resolver registry', () => {
  it('orders free resolvers before paid ones', () => {
    const firstPaid = RESOLVERS.findIndex((r) => !r.free);
    const lastFree = RESOLVERS.map((r) => r.free).lastIndexOf(true);
    expect(lastFree).toBeLessThan(firstPaid);
  });

  it('marks skip-trace as the ONLY paid resolver, and the only one needing registration', () => {
    const paid = RESOLVERS.filter((r) => !r.free).map((r) => r.id);
    expect(paid).toEqual(['skip-trace']);

    const gated = RESOLVERS.filter((r) => r.requiresCarrierRegistration).map((r) => r.id);
    expect(gated).toEqual(['skip-trace']);
  });

  it('offers at least one registration-free resolver per non-phone channel', () => {
    const free = registrationFreeResolvers();
    expect(free.map((r) => r.channel).sort()).toEqual(['email', 'mail']);
    expect(free.every((r) => r.costCentsPerAttempt === 0)).toBe(true);
  });

  it('exposes the mailing resolver at zero cost — the universal default', () => {
    const r = getResolver('public-record-mailing')!;
    expect(r.costCentsPerAttempt).toBe(0);
    expect(r.requiresCarrierRegistration).toBe(false);
    expect(r.channel).toBe('mail');
  });
});

describe('looksLikeEntity', () => {
  it('detects common entity forms', () => {
    for (const n of [
      'ACME PROPERTIES LLC',
      'Smith Holdings Inc',
      'Jones Family Trust',
      'BLUEGRASS REALTY GROUP',
      'ESTATE OF JOHN DOE',
      'Oak Partners LP',
    ]) {
      expect(looksLikeEntity(n), n).toBe(true);
    }
  });

  it('does not flag ordinary personal names', () => {
    for (const n of ['John Smith', 'Maria Garcia', 'Robert Q Public']) {
      expect(looksLikeEntity(n), n).toBe(false);
    }
  });

  it('is false for null/empty rather than throwing', () => {
    expect(looksLikeEntity(null)).toBe(false);
    expect(looksLikeEntity(undefined)).toBe(false);
    expect(looksLikeEntity('')).toBe(false);
  });
});

describe('resolveContacts — free first, paid never implicit', () => {
  it('resolves a mail contact at zero cost from the mailing address alone', () => {
    const r = resolveContacts({ mailing_address: '123 Main St, Louisville, KY 40202' });
    expect(r.contacts).toEqual([
      {
        channel: 'mail',
        value: '123 Main St, Louisville, KY 40202',
        resolver: 'public-record-mailing',
        costCents: 0,
      },
    ]);
    expect(r.totalCostCents).toBe(0);
  });

  it('falls back to the property address when no mailing address is held', () => {
    const r = resolveContacts({ property_address: '9 Oak St, Louisville, KY 40203' });
    expect(r.contacts[0].channel).toBe('mail');
    expect(r.contacts[0].costCents).toBe(0);
  });

  it('adds a free email contact for an entity-owned parcel', () => {
    const r = resolveContacts({
      mailing_address: '123 Main St, Louisville, KY 40202',
      owner_name: 'ACME PROPERTIES LLC',
      entity_email: 'agent@acmeprops.com',
    });
    expect(r.contacts.map((c) => c.channel).sort()).toEqual(['email', 'mail']);
    expect(r.totalCostCents).toBe(0);
  });

  it('NEVER incurs cost — resolution is pure and reports paid availability only', () => {
    const r = resolveContacts({ owner_name: 'John Smith' }, { allowPaid: true });
    expect(r.totalCostCents).toBe(0);
    expect(r.paidAvailable).toBe(true); // a phone lookup is possible, not performed
  });

  it('does not suggest paid lookup when a free contact already exists', () => {
    const r = resolveContacts({
      mailing_address: '123 Main St, Louisville, KY 40202',
      owner_name: 'John Smith',
    });
    expect(r.paidAvailable).toBe(false);
  });

  it('honours a channel restriction', () => {
    const r = resolveContacts(
      { mailing_address: '123 Main St, Louisville, KY 40202', entity_email: 'a@b.com' },
      { allowedChannels: ['email'] }
    );
    expect(r.contacts.map((c) => c.channel)).toEqual(['email']);
  });

  it('returns nothing resolvable for a row with no address at all', () => {
    const r = resolveContacts({ owner_name: 'ACME LLC' });
    expect(r.contacts).toEqual([]);
  });
});

describe('resolverRoi', () => {
  it('computes cost per USABLE contact, not per attempt', () => {
    const [roi] = resolverRoi([{ resolver: 'skip-trace', attempts: 1000, hits: 400, costCents: 10000 }]);
    expect(roi.hitRate).toBeCloseTo(0.4, 10);
    expect(roi.costPerHitCents).toBe(25); // 10000c / 400 hits, not 10c/attempt
  });

  it('reports null — not Infinity — when a resolver has no hits', () => {
    // Infinity would sort as "infinitely expensive" beside real measurements;
    // null is honestly "no data yet".
    const [roi] = resolverRoi([{ resolver: 'skip-trace', attempts: 50, hits: 0, costCents: 500 }]);
    expect(roi.costPerHitCents).toBeNull();
    expect(roi.hitRate).toBe(0);
  });

  it('handles a zero-attempt resolver without dividing by zero', () => {
    const [roi] = resolverRoi([{ resolver: 'entity-lookup', attempts: 0, hits: 0, costCents: 0 }]);
    expect(roi.hitRate).toBe(0);
    expect(roi.costPerHitCents).toBeNull();
  });
});

describe('paidResolverJustified — spend must earn its place', () => {
  it('refuses spend when there is no measurement yet', () => {
    const v = paidResolverJustified({
      freeCoverage: 0.5,
      paidCostPerHitCents: null,
      expectedValuePerContactCents: 500,
    });
    expect(v.justified).toBe(false);
    expect(v.reason).toMatch(/no paid-resolver data/);
  });

  it('refuses spend when free resolvers already reach almost everyone', () => {
    // Buying phones for leads you can already mail adds a channel that ALSO
    // needs carrier registration — strictly worse than the free option.
    const v = paidResolverJustified({
      freeCoverage: 0.98,
      paidCostPerHitCents: 25,
      expectedValuePerContactCents: 500,
    });
    expect(v.justified).toBe(false);
    expect(v.reason).toMatch(/already reach 98/);
  });

  it('refuses spend when cost per usable contact exceeds its value', () => {
    const v = paidResolverJustified({
      freeCoverage: 0.4,
      paidCostPerHitCents: 600,
      expectedValuePerContactCents: 500,
    });
    expect(v.justified).toBe(false);
    expect(v.reason).toMatch(/exceeds expected value/);
  });

  it('justifies spend on a real gap at a favourable cost', () => {
    const v = paidResolverJustified({
      freeCoverage: 0.4,
      paidCostPerHitCents: 25,
      expectedValuePerContactCents: 500,
    });
    expect(v.justified).toBe(true);
  });
});
