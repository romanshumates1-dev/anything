/**
 * Security regression guard (Phase 5.5): API error responses must NOT leak the
 * raw error message (DB errors, stack detail) to the client. The full error is
 * logged server-side via console.error; the response body stays generic.
 *
 * This test fails if anyone reintroduces `detail: error.message` in a route.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.includes('__tests__')) out.push(p);
  }
  return out;
}

describe('API error responses do not leak error.message', () => {
  const apiDir = join(process.cwd(), 'src', 'app', 'api');
  const files = walk(apiDir);

  it('scans a non-zero number of route files', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('no route returns `detail: error.message` (info-disclosure)', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      if (/detail:\s*error\??\.message/.test(src)) offenders.push(f.replace(apiDir, ''));
    }
    expect(offenders, `routes leaking error.message: ${offenders.join(', ')}`).toEqual([]);
  });
});
