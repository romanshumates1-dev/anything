import { describe, it, expect } from 'vitest';
import {
  normalizePhone,
  dedupeHash,
  parseCsvLine,
  parseLeadsCsv,
  dedupeInBatch,
  chunk,
  MAX_IMPORT_ROWS,
} from '../ingestion';

describe('normalizePhone', () => {
  it('strips formatting and defaults bare 10-digit US to +1', () => {
    expect(normalizePhone('+1 (555) 555-0100')).toBe('+15555550100');
    expect(normalizePhone('555.555.0100')).toBe('+15555550100');
    expect(normalizePhone('')).toBe('');
    expect(normalizePhone(null)).toBe('');
  });
});

describe('dedupeHash', () => {
  it('prefers phone, falls back to email, normalizes both', () => {
    expect(dedupeHash('+1 555 555 0100', 'A@B.com')).toBe('phone:+15555550100');
    expect(dedupeHash(null, 'A@B.com')).toBe('email:a@b.com');
    expect(dedupeHash(null, null)).toBe('');
  });
  it('produces equal hashes for equivalent contacts', () => {
    expect(dedupeHash('(555) 555-0100', null)).toBe(dedupeHash('555.555.0100', null));
  });
});

describe('parseCsvLine', () => {
  it('handles quoted fields with embedded commas', () => {
    expect(parseCsvLine('"Acme, LLC",+15555550100,a@b.com')).toEqual([
      'Acme, LLC',
      '+15555550100',
      'a@b.com',
    ]);
  });
  it('handles escaped quotes', () => {
    expect(parseCsvLine('"She said ""hi""",x')).toEqual(['She said "hi"', 'x']);
  });
});

describe('parseLeadsCsv', () => {
  it('parses a headered CSV and validates rows', () => {
    const csv = [
      'name,phone,email,type',
      'Acme Test LLC,+15555550100,acme@test.com,seller',
      'Bob Buyer,+15555550101,,buyer',
    ].join('\n');
    const { valid, failures, totalRows } = parseLeadsCsv(csv);
    expect(totalRows).toBe(2);
    expect(failures).toHaveLength(0);
    expect(valid).toHaveLength(2);
    expect(valid[0]).toMatchObject({
      name: 'Acme Test LLC',
      type: 'seller',
      phone: '+15555550100',
    });
    expect(valid[1].type).toBe('buyer');
  });

  it('flags rows missing name or all contacts', () => {
    const csv = ['name,phone,email', ',+15555550100,', 'No Contact,,'].join('\n');
    const { valid, failures } = parseLeadsCsv(csv);
    expect(valid).toHaveLength(0);
    expect(failures).toHaveLength(2);
    expect(failures[0].reason).toMatch(/name/i);
    expect(failures[1].reason).toMatch(/phone and email/i);
  });

  it('rejects invalid emails', () => {
    const csv = ['name,email', 'Bad Email,not-an-email'].join('\n');
    const { failures } = parseLeadsCsv(csv);
    expect(failures[0].reason).toMatch(/invalid email/i);
  });

  it('defaults type to seller when missing/invalid', () => {
    const csv = ['name,phone,type', 'X,+15555550100,wizard'].join('\n');
    const { valid } = parseLeadsCsv(csv, 'seller');
    expect(valid[0].type).toBe('seller');
  });

  it('supports headerless name,phone,email,type ordering', () => {
    const csv = 'Acme,+15555550100,a@b.com,buyer';
    const { valid } = parseLeadsCsv(csv);
    expect(valid[0]).toMatchObject({ name: 'Acme', type: 'buyer', phone: '+15555550100' });
  });

  it('enforces the 10k row cap', () => {
    const rows = ['name,phone'];
    for (let i = 0; i < MAX_IMPORT_ROWS + 1; i++) rows.push(`Lead ${i},+1555555${i}`);
    const { failures, totalRows } = parseLeadsCsv(rows.join('\n'));
    expect(totalRows).toBeGreaterThan(MAX_IMPORT_ROWS);
    expect(failures[0].reason).toMatch(/exceeds/i);
  });

  it('parses 10k rows within the cap', () => {
    const rows = ['name,phone'];
    for (let i = 0; i < MAX_IMPORT_ROWS; i++)
      rows.push(`Lead ${i},+1555${String(i).padStart(7, '0')}`);
    const { valid, totalRows } = parseLeadsCsv(rows.join('\n'));
    expect(totalRows).toBe(MAX_IMPORT_ROWS);
    expect(valid).toHaveLength(MAX_IMPORT_ROWS);
  });
});

describe('dedupeInBatch', () => {
  it('removes in-batch duplicates by hash, keeping first', () => {
    const csv = [
      'name,phone',
      'First,+15555550100',
      'Dupe,(555) 555-0100',
      'Unique,+15555550101',
    ].join('\n');
    const { valid } = parseLeadsCsv(csv);
    const { unique, duplicates } = dedupeInBatch(valid);
    expect(unique).toHaveLength(2);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].name).toBe('Dupe');
  });
});

describe('chunk', () => {
  it('splits arrays into fixed-size batches', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
