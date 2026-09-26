/**
 * Apollo normalization tests — pure logic, offline, deterministic.
 * Includes the data-minimization regression: contact data must NEVER survive.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeApolloPerson,
  normalizeApolloPeople,
  dedupeApolloBatch,
} from './normalize';

const FULL_PERSON = {
  id: 'p-123',
  first_name: 'Jane',
  last_name: 'Doe',
  title: 'CEO',
  seniority: 'C-Level',
  city: 'Austin',
  state: 'TX',
  country: 'USA',
  organization: { name: 'Acme Capital', industry: 'Real Estate' },
  emails: [{ email: 'jane@acmecapital.com', type: 'work' }],
  phone_numbers: [{ phone: '+1-512-555-0142' }],
};

describe('normalizeApolloPerson', () => {
  it('normalizes a full person into sourced-lead shape', () => {
    const lead = normalizeApolloPerson(FULL_PERSON);
    expect(lead).not.toBeNull();
    expect(lead!.ownerName).toBe('Jane Doe');
    expect(lead!.company).toBe('Acme Capital');
    expect(lead!.title).toBe('CEO');
    expect(lead!.seniority).toBe('C-Level');
    expect(lead!.city).toBe('Austin');
    expect(lead!.industry).toBe('Real Estate');
    expect(lead!.apolloPersonId).toBe('p-123');
    expect(lead!.signals).toContain('apollo_sourced');
    expect(lead!.rawFields.company).toBe('Acme Capital');
  });

  it('NEVER persists contact data (emails/phones stripped + scrubbed)', () => {
    const lead = normalizeApolloPerson(FULL_PERSON);
    const serialized = JSON.stringify(lead);
    expect(serialized).not.toContain('jane@acmecapital.com');
    expect(serialized).not.toContain('512-555-0142');
    expect(serialized).not.toContain('@acmecapital');

    // Freeform contact values hidden inside fields are redacted defense-in-depth.
    const dirty = normalizeApolloPerson({
      first_name: 'R',
      last_name: 'Last',
      organization: { name: 'Reach Me At rob@spam.com Or 555-123-4567' },
    });
    const dirtyStr = JSON.stringify(dirty);
    expect(dirtyStr).not.toContain('rob@spam.com');
    expect(dirtyStr).not.toContain('555-123-4567');
    expect(dirtyStr).toContain('[redacted-email]');
  });

  it('falls back to the company when no person name exists', () => {
    const lead = normalizeApolloPerson({ organization: { name: 'Buyer Group LLC' } });
    expect(lead!.ownerName).toBe('Buyer Group LLC');
    expect(lead!.company).toBe('Buyer Group LLC');
  });

  it('rejects garbage and empty records (never inserted)', () => {
    expect(normalizeApolloPerson(null)).toBeNull();
    expect(normalizeApolloPerson(undefined)).toBeNull();
    expect(normalizeApolloPerson('string')).toBeNull();
    expect(normalizeApolloPerson([1, 2, 3])).toBeNull();
    expect(normalizeApolloPerson({})).toBeNull();
    expect(normalizeApolloPerson({ first_name: '', organization: {} })).toBeNull();
  });

  it('builds deterministic dedupe keys (same person collapses, different company differs)', () => {
    const a = normalizeApolloPerson(FULL_PERSON)!;
    const b = normalizeApolloPerson(structuredClone(FULL_PERSON))!;
    expect(a.dedupeKey).toBe(b.dedupeKey);

    const c = normalizeApolloPerson({
      ...FULL_PERSON,
      organization: { name: 'Other Capital' },
    })!;
    expect(c.dedupeKey).not.toBe(a.dedupeKey);
  });
});

describe('normalizeApolloPeople / dedupeApolloBatch', () => {
  it('counts invalid records and keeps valid ones', () => {
    const { leads, invalid } = normalizeApolloPeople([FULL_PERSON, null, {}, 'junk']);
    expect(leads).toHaveLength(1);
    expect(invalid).toBe(3);
  });

  it('collapses in-batch duplicates deterministically', () => {
    const { leads } = normalizeApolloPeople([
      FULL_PERSON,
      structuredClone(FULL_PERSON),
      { first_name: 'Other', last_name: 'Person', organization: { name: 'Acme Capital' } },
    ]);
    const { unique, duplicates } = dedupeApolloBatch(leads);
    expect(unique).toHaveLength(2);
    expect(duplicates).toBe(1);
  });
});
