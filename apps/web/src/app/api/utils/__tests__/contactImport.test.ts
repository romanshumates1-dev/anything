import { describe, it, expect } from 'vitest';
import { parseContactList, dedupeContacts } from '../contactImport';

describe('parseContactList', () => {
  it('parses Name, Phone comma-separated', () => {
    const result = parseContactList('John Smith, 555-123-4567');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('John Smith');
    expect(result[0].phone).toBe('+15551234567');
    expect(result[0].valid).toBe(true);
  });

  it('parses Phone, Name comma-separated', () => {
    const result = parseContactList('555-123-4567, John Smith');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('John Smith');
    expect(result[0].phone).toBe('+15551234567');
  });

  it('parses tab-separated', () => {
    const result = parseContactList('John Smith\t555-123-4567');
    expect(result).toHaveLength(1);
    expect(result[0].valid).toBe(true);
  });

  it('parses space-separated Name + Phone', () => {
    const result = parseContactList('John Smith 5551234567');
    expect(result).toHaveLength(1);
    expect(result[0].valid).toBe(true);
  });

  it('handles quoted CSV fields', () => {
    const result = parseContactList('"Doe, John", 555-123-4567');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Doe, John');
  });

  it('skips empty lines', () => {
    const result = parseContactList('John Smith, 555-123-4567\n\nJane Doe, 555-987-6543');
    expect(result).toHaveLength(2);
  });

  it('flags malformed numbers as invalid', () => {
    const result = parseContactList('Bad Line\nJohn Smith, 123');
    expect(result).toHaveLength(2);
    expect(result[0].valid).toBe(false);
    expect(result[0].error).toBeDefined();
  });

  it('handles duplicate numbers', () => {
    const result = parseContactList('John, 555-123-4567\nJane, 555-123-4567');
    expect(result).toHaveLength(2);
  });

  it('handles non-US numbers with leading +', () => {
    const result = parseContactList('John Smith, +44 7911 123456');
    expect(result).toHaveLength(1);
    expect(result[0].valid).toBe(true);
    expect(result[0].phone).toBe('+447911123456');
  });

  it('handles name-only lines (no phone)', () => {
    const result = parseContactList('John Smith');
    expect(result).toHaveLength(1);
    expect(result[0].valid).toBe(false);
    expect(result[0].error).toContain('Invalid phone');
  });
});

describe('dedupeContacts', () => {
  it('removes duplicate valid phones', () => {
    const contacts = [
      { name: 'A', phone: '+15551234567', raw: 'A, 555-123-4567', valid: true },
      { name: 'B', phone: '+15551234567', raw: 'B, 555-123-4567', valid: true },
    ];
    const result = dedupeContacts(contacts);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('A');
  });

  it('keeps invalid rows in output', () => {
    const contacts = [
      { name: 'A', phone: 'bad', raw: 'A bad', valid: false },
    ];
    const result = dedupeContacts(contacts);
    expect(result).toHaveLength(1);
    expect(result[0].valid).toBe(false);
  });

  it('preserves order', () => {
    const contacts = [
      { name: 'A', phone: '+15551111111', raw: '', valid: true },
      { name: 'B', phone: '+15552222222', raw: '', valid: true },
      { name: 'C', phone: '+15553333333', raw: '', valid: true },
    ];
    const result = dedupeContacts(contacts);
    expect(result.map(c => c.name)).toEqual(['A', 'B', 'C']);
  });
});