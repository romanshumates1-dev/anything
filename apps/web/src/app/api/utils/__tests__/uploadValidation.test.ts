/**
 * Item 7 (size limit) — the Dropzone's 5MB / extension guard (behavioral).
 *
 * The size limit is enforced in the client Dropzone via validateUploadFile.
 * This tests that pure guard directly (no React render needed).
 */
import { describe, it, expect } from 'vitest';
import { validateUploadFile } from '@/lib/uploadValidation';

const LIMITS = { accept: ['.csv', '.txt'], maxSizeMB: 5 };

describe('Item 7 — upload size/extension validation', () => {
  it('rejects a 6MB file with a clear max-size error', () => {
    const result = validateUploadFile({ name: 'contacts.csv', size: 6 * 1024 * 1024 }, LIMITS);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('File too large. Max size: 5MB');
  });

  it('accepts a file just under the 5MB limit', () => {
    const result = validateUploadFile({ name: 'contacts.csv', size: 5 * 1024 * 1024 - 1 }, LIMITS);
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('rejects an unaccepted extension before considering size', () => {
    const result = validateUploadFile({ name: 'contacts.pdf', size: 10 }, LIMITS);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Invalid file type/);
  });
});
