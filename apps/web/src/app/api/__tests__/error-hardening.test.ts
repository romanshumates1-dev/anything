/**
 * Security regression guard (Phase 5.5): API error responses must NOT leak the
 * raw error message (DB errors, stack detail) to the client. The full error is
 * logged server-side via console.error; the response body stays generic.
 *
 * This test fails if anyone reintroduces `detail: error.message` in a route.
 */
import { describe, it, expect } from 'vitest';
import { scanSource, readSource, API_ROOT } from './security/_sourceScan';


describe('API error responses do not leak error.message', () => {
  const apiDir = API_ROOT;
  // .ts only (matches the original scan surface), excluding test files.
  const files = scanSource(apiDir, { extensions: ['ts'] });

  it('scans a non-zero number of route files', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('no route returns `detail: error.message` (info-disclosure)', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readSource(f);
      if (/detail:\s*error\??\.message/.test(src)) offenders.push(f.replace(apiDir, ''));
    }
    expect(offenders, `routes leaking error.message: ${offenders.join(', ')}`).toEqual([]);
  });
});
