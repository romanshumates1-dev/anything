// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { middleware } from './middleware';
import { scanSource, readSource } from './app/api/__tests__/security/_sourceScan';

/**
 * Wiring proof: the cross-site gate actually runs inside middleware() BEFORE
 * any other logic, on a path (/api/campaigns/monitor) that otherwise bypasses
 * all auth so no database round trip is involved.
 */

function req(path: string, method: string, headers: Record<string, string>) {
  return new NextRequest(`http://localhost:4000${path}`, { method, headers });
}

describe('middleware CSRF wiring', () => {
  it('rejects a cross-site POST before any other handling (403)', async () => {
    const res = await middleware(
      req('/api/campaigns/monitor', 'POST', { origin: 'https://evil.example' })
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/cross-origin/i);
  });

  it('lets a same-origin POST continue past the gate', async () => {
    const res = await middleware(
      req('/api/campaigns/monitor', 'POST', { origin: 'http://localhost:4000' })
    );
    expect(res.status).not.toBe(403);
  });

  it('does not touch safe methods even with a hostile Origin', async () => {
    const res = await middleware(
      req('/api/campaigns/monitor', 'GET', { origin: 'https://evil.example' })
    );
    expect(res.status).not.toBe(403);
  });

  it('does not touch webhook-style POSTs (no Origin header at all)', async () => {
    const res = await middleware(req('/api/campaigns/monitor', 'POST', {}));
    expect(res.status).not.toBe(403);
  });
});

/**
 * CORS posture as a ratchet, not a one-time observation.
 *
 * The app is same-origin only: nothing in the codebase may emit an
 * `Access-Control-Allow-Origin` header. Emitting one (especially by reflecting
 * the request Origin) would hand a hostile page a readable response to
 * authenticated requests and would undermine the origin gate above, which is
 * the actual defence.
 */
describe('CORS posture', () => {
  const files = scanSource(join(process.cwd(), 'src'), {
    extensions: ['ts', 'tsx', 'mjs', 'cjs'],
    skipDirs: ['node_modules', '__tests__', '.next'],
    excludeTests: true,
  });

  it('no shipped source file emits an Access-Control-Allow-* header', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (readSource(file).includes('Access-Control-Allow')) offenders.push(file);
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('next.config.js emits no Access-Control-* header either', () => {
    const configPath = join(process.cwd(), 'next.config.js');
    if (!existsSync(configPath)) return; // nothing to police
    const text = readFileSync(configPath, 'utf8');
    expect(text).not.toMatch(/Access-Control-Allow/i);
  });
});
