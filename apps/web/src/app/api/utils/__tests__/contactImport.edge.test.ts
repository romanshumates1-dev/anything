import { describe, it, expect } from 'vitest';
import { parseContactList, dedupeContacts } from '../contactImport';

describe('parseContactList edge cases', () => {
  it('empty input returns empty array', () => {
    expect(parseContactList('')).toHaveLength(0);
    expect(parseContactList('\n\n')).toHaveLength(0);
  });

  it('header-only line produces invalid contact (no phone digits)', () => {
    const result = parseContactList('name,phone');
    expect(result).toHaveLength(1);
    expect(result[0].valid).toBe(false);
  });

  it('name with no phone is invalid', () => {
    const result = parseContactList('John Smith\nJane Doe');
    expect(result).toHaveLength(2);
    expect(result.every(r => !r.valid)).toBe(true);
    expect(result[0].error).toContain('Invalid phone');
  });

  it('phone with no name still valid', () => {
    const result = parseContactList('555-123-4567');
    expect(result).toHaveLength(1);
    expect(result[0].valid).toBe(true);
    expect(result[0].name).toBe('Unknown');
    expect(result[0].phone).toBe('+15551234567');
  });

  it('duplicate phone numbers across different name spellings collapse', () => {
    const result = parseContactList('John, 555-123-4567\nJonathan Smith, 555-123-4567');
    expect(result).toHaveLength(2);
    expect(result[0].phone).toBe(result[1].phone);
  });

  it('international (+44, +1) plus bare 10-digit US all normalize distinctly', () => {
    const result = parseContactList([
      'UK,+44 7911 123456',
      'US,+1 555-123-4567',
      'Bare US,5551234567',
    ].join('\n'));
    expect(result).toHaveLength(3);
    expect(result[0].phone).toBe('+447911123456');
    expect(result[1].phone).toBe('+15551234567');
    expect(result[2].phone).toBe('+15551234567'); // bare gets +1
    expect(result[1].phone).toBe(result[2].phone); // same
  });

  it('emoji and non-ASCII in name pass through unmodified', () => {
    const result = parseContactList('José García 🏠, 555-123-4567');
    expect(result).toHaveLength(1);
    expect(result[0].valid).toBe(true);
    expect(result[0].name).toBe('José García 🏠');
    expect(result[0].phone).toBe('+15551234567');
  });
});