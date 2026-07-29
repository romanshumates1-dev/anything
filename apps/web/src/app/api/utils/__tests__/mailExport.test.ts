/**
 * mailExport — tracking codes + print-ready batch.
 *
 * Direct mail has no delivery receipt and no reply-to, so the tracking code is
 * the ONLY attribution mechanism. Two failure modes are silent and therefore
 * pinned hardest here:
 *   - an ambiguous character (O/0, I/1) makes a code unreadable off a postcard,
 *     and the lookup just misses — the response is credited to nothing.
 *   - a duplicate code merges two prospects into one bucket, and the wrong
 *     piece gets the credit with no way to detect it afterwards.
 */
import { describe, it, expect } from 'vitest';
import {
  generateTrackingCode,
  normalizeTrackingCode,
  buildMailCsv,
  summarizeBatch,
  MAIL_CSV_HEADERS,
  type MailPieceRow,
} from '../mailExport';

const piece = (over: Partial<MailPieceRow> = {}): MailPieceRow => ({
  trackingCode: 'ACDEFG',
  recipientName: 'Jane Owner',
  mailingAddress: '123 Main St, Louisville, KY 40202',
  leadId: 42,
  unitCostCents: 55,
  ...over,
});

describe('generateTrackingCode', () => {
  it('produces a 6-character code', () => {
    expect(generateTrackingCode()).toHaveLength(6);
  });

  it('NEVER emits a character that is ambiguous when read aloud', () => {
    // 0/O, 1/I/L, 2/Z, 5/S, 8/B all excluded — a code that cannot be dictated
    // over the phone fails at exactly the moment it is supposed to work.
    const banned = /[01258OILZSB]/;
    for (let i = 0; i < 500; i++) {
      const code = generateTrackingCode();
      expect(banned.test(code), `ambiguous char in ${code}`).toBe(false);
    }
  });

  it('is deterministic with an injected rand (no global stubbing needed)', () => {
    const fixed = () => 0;
    expect(generateTrackingCode(fixed)).toBe('333333');
  });

  it('spans the alphabet rather than clustering', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateTrackingCode()));
    expect(codes.size).toBeGreaterThan(190); // collisions should be rare at 25^6
  });
});

describe('normalizeTrackingCode', () => {
  it('accepts a clean code unchanged', () => {
    expect(normalizeTrackingCode('ACDEFG')).toBe('ACDEFG');
  });

  it('strips spacing and dashes a human adds when reading aloud', () => {
    expect(normalizeTrackingCode('ACD-EFG')).toBe('ACDEFG');
    expect(normalizeTrackingCode(' acd efg ')).toBe('ACDEFG');
  });

  it('lower-case input is accepted', () => {
    expect(normalizeTrackingCode('acdefg')).toBe('ACDEFG');
  });

  it('returns null for a wrong-length code instead of a wrong match', () => {
    // A truncated code must fail loudly, not silently resolve to some piece.
    expect(normalizeTrackingCode('ACD')).toBeNull();
    expect(normalizeTrackingCode('ACDEFGHJ')).toBeNull();
    expect(normalizeTrackingCode('')).toBeNull();
    expect(normalizeTrackingCode(null)).toBeNull();
  });
});

describe('buildMailCsv', () => {
  it('emits the documented header row', () => {
    const csv = buildMailCsv([piece()]);
    expect(csv.split('\n')[0]).toBe(MAIL_CSV_HEADERS.join(','));
  });

  it('quotes every field so a comma in an address cannot break the row', () => {
    // Vendors reject a whole batch on a malformed row; an address with commas
    // is the common case here, not an edge case.
    const csv = buildMailCsv([piece()]);
    const row = csv.split('\n')[1];
    expect(row).toContain('"123 Main St, Louisville, KY 40202"');
    expect(row.split('","').length).toBe(MAIL_CSV_HEADERS.length);
  });

  it('escapes embedded quotes per RFC 4180', () => {
    const csv = buildMailCsv([piece({ recipientName: 'Jane "JJ" Owner' })]);
    expect(csv).toContain('"Jane ""JJ"" Owner"');
  });

  it('interpolates the piece code into the CTA so the vendor merges ONE field', () => {
    // Every assembly step at the vendor is a place code and address can
    // desynchronise across rows.
    const csv = buildMailCsv([piece({ trackingCode: 'MNPQRT' })], {
      ctaTemplate: 'Text OFFER-{CODE} to 55555',
    });
    expect(csv).toContain('Text OFFER-MNPQRT to 55555');
  });

  it('ends with a newline — some vendor parsers drop the last record without it', () => {
    expect(buildMailCsv([piece()]).endsWith('\n')).toBe(true);
  });

  it('produces a header-only file for an empty batch', () => {
    const csv = buildMailCsv([]);
    expect(csv.trim()).toBe(MAIL_CSV_HEADERS.join(','));
  });

  it('handles a null lead id without printing "null" as a name', () => {
    const csv = buildMailCsv([piece({ leadId: null })]);
    expect(csv.split('\n')[1]).toContain('""');
  });
});

describe('summarizeBatch', () => {
  it('totals real per-piece cost', () => {
    const s = summarizeBatch([piece({ unitCostCents: 55 }), piece({ trackingCode: 'MNPQRT', unitCostCents: 70 })]);
    expect(s.pieces).toBe(2);
    expect(s.totalCostCents).toBe(125);
    expect(s.totalCostUsd).toBe(1.25);
  });

  it('DETECTS duplicate codes — the silent attribution corrupter', () => {
    // A duplicate merges two prospects into one bucket and is undetectable
    // after the fact: the response looks legitimate, credited to the wrong piece.
    const s = summarizeBatch([piece(), piece(), piece({ trackingCode: 'MNPQRT' })]);
    expect(s.duplicateCodes).toBe(1);
  });

  it('reports zero duplicates on a clean batch', () => {
    const s = summarizeBatch([piece({ trackingCode: 'ACDEFG' }), piece({ trackingCode: 'MNPQRT' })]);
    expect(s.duplicateCodes).toBe(0);
  });

  it('prices a 10,000-piece run', () => {
    const pieces = Array.from({ length: 10000 }, (_, i) => piece({ trackingCode: `C${i}` }));
    expect(summarizeBatch(pieces).totalCostUsd).toBe(5500);
  });
});
