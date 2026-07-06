/**
 * Item 7 — contact/CSV parser limits (behavioral).
 *
 * Covers the row cap (parseLeadsCsv), and the flag-not-drop + preview-count
 * behavior (parseContactList). The 5MB size limit is component-level and is
 * covered by uploadValidation.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { parseLeadsCsv, MAX_IMPORT_ROWS } from '../ingestion';
import { parseContactList, dedupeContacts } from '../contactImport';

describe('Item 7 — row cap (parseLeadsCsv)', () => {
  it('rejects a file that exceeds the 10,000-row limit with a clear error', () => {
    const rows = ['name,phone'];
    for (let i = 0; i < MAX_IMPORT_ROWS + 1; i++) {
      rows.push(`Lead ${i},+1555${String(i).padStart(7, '0')}`);
    }
    const result = parseLeadsCsv(rows.join('\n'));
    expect(result.totalRows).toBeGreaterThan(MAX_IMPORT_ROWS);
    expect(result.valid).toHaveLength(0); // nothing imported when over cap
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].reason).toMatch(/exceeds .*10000 row limit/i);
  });

  it('accepts a file exactly at the cap', () => {
    const rows = ['name,phone'];
    for (let i = 0; i < MAX_IMPORT_ROWS; i++) {
      rows.push(`Lead ${i},+1555${String(i).padStart(7, '0')}`);
    }
    const result = parseLeadsCsv(rows.join('\n'));
    expect(result.totalRows).toBe(MAX_IMPORT_ROWS);
    expect(result.failures.some((f) => /exceeds/i.test(f.reason))).toBe(false);
  });
});

describe('Item 7 — malformed rows are flagged, not dropped (parseContactList)', () => {
  it('keeps every input line and marks the malformed ones invalid', () => {
    const parsed = parseContactList('Good, 555-123-4567\nBadRow\nAlso Bad, 123');
    expect(parsed).toHaveLength(3); // nothing dropped
    expect(parsed.filter((c) => c.valid)).toHaveLength(1);
    const invalid = parsed.filter((c) => !c.valid);
    expect(invalid).toHaveLength(2);
    // invalid rows carry an explanatory error rather than being silently removed
    expect(invalid.every((c) => typeof c.error === 'string' && c.error.length > 0)).toBe(true);
  });
});

describe('Item 7 — valid mixed file preview counts (parseContactList + dedupe)', () => {
  it('collapses duplicates among valid rows while retaining flagged rows', () => {
    const parsed = parseContactList(
      'John, 555-123-4567\nBad\nJane, 555-987-6543\nJohn, 555-123-4567'
    );
    const deduped = dedupeContacts(parsed);
    expect(deduped.filter((c) => c.valid)).toHaveLength(2); // John dedup'd, Jane kept
    expect(deduped.filter((c) => !c.valid)).toHaveLength(1); // 'Bad' retained as invalid
  });
});
