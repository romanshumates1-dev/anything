import { describe, it, expect } from 'vitest';
import {
  parseSourcedCsv,
  dedupeInBatch,
  scoreSourcedLead,
  deriveSignals,
  buildDedupeKey,
  parseMoneyCents,
} from '../normalize';

describe('parseSourcedCsv — compliance + normalization', () => {
  it('STRIPS contact columns (phone/email) — never persisted to raw_fields', () => {
    const csv = [
      'Owner Name,Property Address,Mailing Address,Parcel ID,Assessed Value,Phone,Email',
      'Jane Heir,123 Main St,456 Elsewhere Ave,PID-001,"$120,000",502-555-1212,jane@example.com',
    ].join('\n');
    const { rows } = parseSourcedCsv(csv, { sourceRecordType: 'probate', sourceCategory: 'seller' });
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.ownerName).toBe('Jane Heir');
    expect(r.propertyAddress).toBe('123 Main St');
    expect(r.mailingAddress).toBe('456 Elsewhere Ave');
    expect(r.parcelId).toBe('PID-001');
    expect(r.assessedValueCents).toBe(12_000_000);
    // The contact values must appear NOWHERE in the normalized record.
    const serialized = JSON.stringify(r).toLowerCase();
    expect(serialized).not.toContain('555-1212');
    expect(serialized).not.toContain('jane@example.com');
    expect(Object.keys(r.rawFields).join(',').toLowerCase()).not.toMatch(/phone|email/);
  });

  it('flags a row with no owner/address/parcel as a failure (nothing to act on)', () => {
    const csv = ['Owner Name,Parcel ID', ','].join('\n');
    const { rows, failures } = parseSourcedCsv(csv, { sourceRecordType: 'probate', sourceCategory: 'seller' });
    expect(rows).toHaveLength(0);
    expect(failures).toHaveLength(1);
  });

  it('derives an absentee signal when mailing ≠ property', () => {
    const signals = deriveSignals({
      recordType: 'absentee',
      category: 'seller',
      mailingAddress: 'PO Box 9, Miami FL',
      propertyAddress: '123 Main St, Louisville KY',
      rawFields: {},
    });
    expect(signals).toContain('absentee');
  });

  it('does NOT flag absentee when mailing == property', () => {
    const signals = deriveSignals({
      recordType: 'absentee',
      category: 'seller',
      mailingAddress: '123 Main St',
      propertyAddress: '123 Main St',
      rawFields: {},
    });
    expect(signals).not.toContain('absentee');
  });
});

describe('dedupeInBatch — by county|parcel|address', () => {
  it('collapses rows with the same dedupe key', () => {
    const mk = (parcel: string) => ({
      ownerName: 'x', propertyAddress: '1 A St', mailingAddress: null, parcelId: parcel,
      county: 'Jefferson', assessedValueCents: null, signals: [], rawFields: {},
      dedupeKey: buildDedupeKey('Jefferson', parcel, '1 A St'),
    });
    const { unique, duplicates } = dedupeInBatch([mk('P1'), mk('P1'), mk('P2')]);
    expect(unique).toHaveLength(2);
    expect(duplicates).toBe(1);
  });
});

describe('scoreSourcedLead — stacked distress scores highest', () => {
  const W = 85;
  it('stacked probate + tax + absentee outscores a single absentee signal', () => {
    const stacked = scoreSourcedLead({ signals: ['probate', 'tax_delinquent', 'absentee'], assessedValueCents: 12_000_000, sourceWeight: W });
    const single = scoreSourcedLead({ signals: ['absentee'], assessedValueCents: null, sourceWeight: W });
    expect(stacked.score).toBeGreaterThan(single.score);
    expect(stacked.score).toBeGreaterThan(60);
    expect(single.score).toBeLessThan(30);
  });

  it('produces a human-readable "why" naming the stacked signals', () => {
    const { reasons } = scoreSourcedLead({ signals: ['probate', 'tax_delinquent'], assessedValueCents: null, sourceWeight: W });
    expect(reasons.join(' ')).toMatch(/Stacked distress/i);
    expect(reasons.join(' ')).toMatch(/Probate/i);
    expect(reasons.join(' ')).toMatch(/Tax-delinquent/i);
  });

  it('clamps to 0–100 and surfaces assessed value as equity room', () => {
    const { score, reasons } = scoreSourcedLead({
      signals: ['probate', 'tax_delinquent', 'pre_foreclosure', 'vacant_or_code', 'absentee'],
      assessedValueCents: 25_000_000,
      sourceWeight: 100,
    });
    expect(score).toBeLessThanOrEqual(100);
    expect(score).toBeGreaterThan(80);
    expect(reasons.join(' ')).toMatch(/equity\/margin room/i);
  });

  it('scores a cash buyer from cash_purchase + investor signals', () => {
    const { score } = scoreSourcedLead({ signals: ['cash_purchase', 'investor_entity'], assessedValueCents: null, sourceWeight: 75 });
    expect(score).toBeGreaterThan(30);
  });
});

describe('parseMoneyCents', () => {
  it('parses currency strings to integer cents', () => {
    expect(parseMoneyCents('$120,000')).toBe(12_000_000);
    expect(parseMoneyCents('120000.50')).toBe(12_000_050);
    expect(parseMoneyCents('')).toBeNull();
    expect(parseMoneyCents('n/a')).toBeNull();
  });
});
