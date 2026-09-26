/**
 * Apollo.io normalization (pure logic, no I/O).
 *
 * COMPLIANCE — mirrors utils/normalize.ts: this module NEVER emits
 * phone/email/contact data. Apollo emails/phones are stripped BEFORE anything
 * can reach raw_fields; freeform values are defense-in-depth scrubbed with
 * scrubContactValues. Contacts are resolved downstream by the operator's
 * existing licensed process, exactly like every other source.
 *
 * Dedupe keys follow the platform convention (scoped to the source by the
 * caller): stable, deterministic, lowercased — built from name + company so
 * two pulls of the same person collapse instead of duplicating.
 */
import {
  normalizeWhitespace,
  scrubContactValues,
  buildDedupeKey,
} from '../utils/normalize';

export interface NormalizedApolloLead {
  ownerName: string;
  company: string | null;
  title: string | null;
  seniority: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  industry: string | null;
  apolloPersonId: string | null;
  signals: string[];
  rawFields: Record<string, string>;
  dedupeKey: string;
}

function str(v: unknown): string {
  return typeof v === 'string' ? normalizeWhitespace(v) : '';
}

function scrub(v: string | null): string | null {
  if (!v) return null;
  const cleaned = scrubContactValues(v);
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Normalize one Apollo person record.
 * Returns null when the record has neither a usable name nor a company —
 * invalid records are counted, never inserted.
 */
export function normalizeApolloPerson(person: unknown): NormalizedApolloLead | null {
  if (!person || typeof person !== 'object' || Array.isArray(person)) return null;
  const p = person as Record<string, unknown>;

  const firstName = str(p.first_name);
  const lastName = str(p.last_name);
  const name = scrub([firstName, lastName].filter(Boolean).join(' ') || str(p.name));

  const org =
    p.organization && typeof p.organization === 'object'
      ? ((p.organization as Record<string, unknown>).name ?? null)
      : (p.organization_name ?? null);
  const company = scrub(str(org) || null);

  if (!name && !company) return null;

  const ownerName = (name || company) as string;

  const city = scrub(str(p.city) || null);
  const state = scrub(str(p.state) || null);
  const country = scrub(str(p.country) || null);
  const title = scrub(str(p.title) || null);
  const seniority = scrub(str(p.seniority) || null);
  const industry =
    p.organization && typeof p.organization === 'object'
      ? scrub(str((p.organization as Record<string, unknown>).industry) || null)
      : null;

  const signals = ['apollo_sourced'];
  if (title) signals.push('professional_contact');
  if (seniority) signals.push('seniority_' + seniority.toLowerCase().replace(/[^a-z0-9]+/g, '_'));

  const rawFields: Record<string, string> = {};
  const put = (key: string, value: string | null) => {
    if (value) rawFields[key] = value;
  };
  put('apollo_person_id', str(p.id) || null);
  put('name', name || null);
  put('company', company);
  put('title', title);
  put('seniority', seniority);
  put('industry', industry);
  put('city', city);
  put('state', state);
  put('country', country);

  // Stable identity: name + company (lowercased by buildDedupeKey).
  const dedupeKey = buildDedupeKey(null, null, null, `${ownerName} ${company ?? ''}`.trim());

  return {
    ownerName,
    company,
    title,
    seniority,
    city,
    state,
    country,
    industry,
    apolloPersonId: str(p.id) || null,
    signals,
    rawFields,
    dedupeKey,
  };
}

/** Normalize a page of people; count (never insert) invalid records. */
export function normalizeApolloPeople(people: unknown[]): {
  leads: NormalizedApolloLead[];
  invalid: number;
} {
  const leads: NormalizedApolloLead[] = [];
  let invalid = 0;
  for (const person of people) {
    const lead = normalizeApolloPerson(person);
    if (lead) leads.push(lead);
    else invalid++;
  }
  return { leads, invalid };
}

/** In-batch dedupe by deterministic key (same person+company collapses). */
export function dedupeApolloBatch(leads: NormalizedApolloLead[]): {
  unique: NormalizedApolloLead[];
  duplicates: number;
} {
  const seen = new Set<string>();
  const unique: NormalizedApolloLead[] = [];
  let duplicates = 0;
  for (const lead of leads) {
    if (seen.has(lead.dedupeKey)) {
      duplicates++;
      continue;
    }
    seen.add(lead.dedupeKey);
    unique.push(lead);
  }
  return { unique, duplicates };
}
