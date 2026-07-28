/**
 * parseSourcedRecords — the JSON/API counterpart to parseSourcedCsv.
 *
 * The contract that matters is the one in normalize.ts's header: this module
 * NEVER emits contact data. The schema has no contact columns to catch a leak,
 * so the parser is the only line of defence — and adding a second parser
 * created a second place for that guarantee to break. These tests pin it.
 */
import { describe, it, expect } from 'vitest';
import { parseSourcedRecords } from '../normalize';

const opts = {
  sourceRecordType: 'code_violation',
  sourceCategory: 'seller' as const,
  fallbackCounty: 'Jefferson County, KY',
};

describe('contact stripping (the compliance guarantee)', () => {
  it('drops phone/email/cell fields from raw_fields entirely', () => {
    const { rows } = parseSourcedRecords(
      [
        {
          owner_name: 'Jane Owner',
          property_address: '12 Oak St',
          phone_number: '502-555-0123',
          EmailAddress: 'jane@example.com',
          cell: '5025559999',
          home_telephone: '5025551111',
          fax: '5025552222',
          contact_info: 'call me',
        },
      ],
      opts
    );

    const raw = rows[0].rawFields;
    const blob = JSON.stringify(rows[0]);
    for (const leaked of ['502-555-0123', 'jane@example.com', '5025559999', '5025551111', '5025552222']) {
      expect(blob, `leaked ${leaked}`).not.toContain(leaked);
    }
    for (const key of ['phone_number', 'EmailAddress', 'cell', 'home_telephone', 'fax', 'contact_info']) {
      expect(raw, `kept contact key ${key}`).not.toHaveProperty(key);
    }
    expect(raw.owner_name).toBe('Jane Owner');
  });

  it('keeps "mailing address" — it is an address, not contact info', () => {
    const { rows } = parseSourcedRecords(
      [{ owner_name: 'Jane', mailing_address: 'PO Box 9', property_address: '12 Oak St' }],
      opts
    );
    expect(rows[0].mailingAddress).toBe('PO Box 9');
  });

  it('does not mistake "parcel" for "cell"', () => {
    const { rows } = parseSourcedRecords(
      [{ owner_name: 'Jane', parcel_id: 'P-123', property_address: '12 Oak St' }],
      opts
    );
    expect(rows[0].parcelId).toBe('P-123');
  });
});

describe('scalar handling', () => {
  it('accepts numeric values the way the CSV path accepts numeric strings', () => {
    const { rows } = parseSourcedRecords(
      [{ owner_name: 'Jane', property_address: '12 Oak St', assessed_value: 250000 }],
      opts
    );
    expect(rows[0].assessedValueCents).toBe(25000000);
  });

  it('ignores nested objects rather than storing "[object Object]"', () => {
    // SODA returns a `location` point object; String()-ing it would produce a
    // literal "[object Object]" that then looks like a real field value.
    const { rows } = parseSourcedRecords(
      [
        {
          owner_name: 'Jane',
          property_address: '12 Oak St',
          location: { type: 'Point', coordinates: [-85.7, 38.2] },
        },
      ],
      opts
    );
    expect(JSON.stringify(rows[0])).not.toContain('[object Object]');
    expect(rows[0].rawFields).not.toHaveProperty('location');
  });

  it('treats null/undefined as absent', () => {
    const { rows } = parseSourcedRecords(
      [{ owner_name: 'Jane', property_address: '12 Oak St', notes: null, other: undefined }],
      opts
    );
    expect(rows[0].rawFields).not.toHaveProperty('notes');
    expect(rows[0].rawFields).not.toHaveProperty('other');
  });
});

describe('row identity and failures', () => {
  it('rejects a record with no owner, address, or parcel', () => {
    const { rows, failures } = parseSourcedRecords([{ some_column: 'x' }], opts);
    expect(rows).toHaveLength(0);
    expect(failures).toHaveLength(1);
    expect(failures[0].reason).toMatch(/No owner name/);
  });

  it('accepts a record with ONLY a property address', () => {
    const { rows } = parseSourcedRecords([{ property_address: '12 Oak St' }], opts);
    expect(rows).toHaveLength(1);
    expect(rows[0].dedupeKey).toBeTruthy();
  });

  it('falls back to the source jurisdiction for county', () => {
    const { rows } = parseSourcedRecords([{ property_address: '12 Oak St' }], opts);
    expect(rows[0].county).toBe('Jefferson County, KY');
  });

  it('derives signals and reports totalRows', () => {
    const r = parseSourcedRecords(
      [{ property_address: '1 A St' }, { property_address: '2 B St' }, { junk: 'x' }],
      opts
    );
    expect(r.totalRows).toBe(3);
    expect(r.rows).toHaveLength(2);
    expect(Array.isArray(r.rows[0].signals)).toBe(true);
  });

  it('handles an empty payload without throwing', () => {
    const r = parseSourcedRecords([], opts);
    expect(r).toEqual({ rows: [], failures: [], totalRows: 0 });
  });
});
