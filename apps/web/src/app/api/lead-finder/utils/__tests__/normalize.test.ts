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

  it('strips contact columns with snake_case / compound headers (regression: \\b regex holes)', () => {
    const csv = [
      'Owner Name,Property Address,Parcel ID,phone_number,EmailAddress,Cell Phone,Home Telephone',
      'Ann Owner,1 Elm St,PID-9,502-555-0000,ann@x.com,502-555-1111,502-555-2222',
    ].join('\n');
    const { rows } = parseSourcedCsv(csv, { sourceRecordType: 'probate', sourceCategory: 'seller' });
    const blob = JSON.stringify(rows[0]).toLowerCase();
    for (const leak of ['555-0000', 'ann@x.com', '555-1111', '555-2222']) {
      expect(blob).not.toContain(leak);
    }
    // EmailAddress must NOT be captured as mailing_address (it matched /mail/i before)
    expect(rows[0].mailingAddress).toBeNull();
  });

  it('redacts phone/email VALUES embedded in a non-contact column (defense in depth)', () => {
    const csv = [
      'Owner Name,Property Address,Parcel ID,Notes',
      'Ann Owner,1 Elm St,PID-9,"call 502-555-0000 or ann@x.com re: estate sale"',
    ].join('\n');
    const { rows } = parseSourcedCsv(csv, { sourceRecordType: 'probate', sourceCategory: 'seller' });
    const blob = JSON.stringify(rows[0]);
    expect(blob).not.toContain('502-555-0000');
    expect(blob).not.toContain('ann@x.com');
    // the non-contact note content is preserved (redacted, not dropped)
    expect(rows[0].rawFields['Notes']).toMatch(/estate sale/);
  });

  it('keeps a legitimate "Mailing Address" column (not falsely stripped as contact)', () => {
    const csv = ['Owner Name,Property Address,Mailing Address,Parcel ID', 'A,1 St,PO Box 5,PID-1'].join('\n');
    const { rows } = parseSourcedCsv(csv, { sourceRecordType: 'probate', sourceCategory: 'seller' });
    expect(rows[0].mailingAddress).toBe('PO Box 5');
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

describe('dedupeInBatch — by county|parcel|address|owner', () => {
  it('collapses rows with the same dedupe key', () => {
    const mk = (parcel: string) => ({
      ownerName: 'x', propertyAddress: '1 A St', mailingAddress: null, parcelId: parcel,
      county: 'Jefferson', assessedValueCents: null, signals: [], rawFields: {},
      dedupeKey: buildDedupeKey('Jefferson', parcel, '1 A St', 'x'),
    });
    const { unique, duplicates } = dedupeInBatch([mk('P1'), mk('P1'), mk('P2')]);
    expect(unique).toHaveLength(2);
    expect(duplicates).toBe(1);
  });

  it('does NOT collapse two owner-only rows (regression: owner_name in the key)', () => {
    // No parcel, no address — only distinct owner names. These are different leads.
    const k1 = buildDedupeKey('Jefferson', null, null, 'Alice Heir');
    const k2 = buildDedupeKey('Jefferson', null, null, 'Bob Heir');
    expect(k1).not.toBe(k2);
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

  it('is order-independent — strongest signal gets full weight regardless of array order (regression)', () => {
    // pre_foreclosure (40) is strongest; absentee (15) is weakest.
    const a = scoreSourcedLead({ signals: ['absentee', 'pre_foreclosure'], assessedValueCents: null, sourceWeight: W });
    const b = scoreSourcedLead({ signals: ['pre_foreclosure', 'absentee'], assessedValueCents: null, sourceWeight: W });
    expect(a.score).toBe(b.score);
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
