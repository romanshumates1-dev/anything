/**
 * Dev-only route guard: unauthenticated payment fraud and contract forgery.
 *
 * These tests exist because the guard replaced a check that was, on its own,
 * a credit-card bypass. `POST /api/payments/mock-checkout/complete` accepted a
 * caller-supplied `pi` and `contractId` with NO session, NO admin check and NO
 * secret, and flipped a `payments_ledger` row to 'paid'. Its only barrier was
 * `NODE_ENV === 'production'` - one environment variable away from fraud.
 *
 * The equivalence classes below are chosen around the ways that barrier could
 * fail open: correct production, MISCONFIGURED production, missing secret,
 * wrong secret, absent header, and a genuine developer.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { devOnlyGuard } from '@/app/api/utils/devOnlyRoute';

const ORIGINAL_ENV = { ...process.env };

const req = (headers: Record<string, string> = {}) =>
  new Request('http://x/api/thing', { headers });

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('devOnlyGuard - production is always blocked', () => {
  it('blocks in production even WITH a valid secret', () => {
    process.env.NODE_ENV = 'production';
    process.env.LOCAL_DEV_SECRET = 'correct-secret';
    const res = devOnlyGuard(req({ 'x-local-dev': 'correct-secret' }));
    // A dev route must be unreachable in production full stop.
    expect(res).not.toBeNull();
    expect(res!.status).toBe(404);
  });

  it.each(['staging', 'preview', 'test', ''])(
    'fails CLOSED when NODE_ENV is %j (misconfiguration must not open the door)',
    (nodeEnv) => {
      process.env.NODE_ENV = nodeEnv;
      // The dangerous case: secret IS known to an attacker, or unset.
      process.env.LOCAL_DEV_SECRET = 'correct-secret';
      const res = devOnlyGuard(req({ 'x-local-dev': 'correct-secret' }));
      expect(res, `NODE_ENV=${nodeEnv} must not permit a dev route`).not.toBeNull();
      expect(res!.status).toBe(404);
    }
  );

  it('blocks when NODE_ENV is production regardless of header', () => {
    process.env.NODE_ENV = 'production';
    process.env.LOCAL_DEV_SECRET = 'shhh';
    for (const headers of [{}, { 'x-local-dev': '' }, { 'x-local-dev': 'shhh' }]) {
      expect(devOnlyGuard(req(headers))).not.toBeNull();
    }
  });
});

describe('devOnlyGuard - outside production, a secret is still required', () => {
  it('fails CLOSED when LOCAL_DEV_SECRET is unset (never defaults to allow)', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.LOCAL_DEV_SECRET;
    // This is the regression that matters: defaulting to "allow" here would
    // restore the original vulnerability on any deploy that forgot the var.
    expect(devOnlyGuard(req({ 'x-local-dev': 'anything' }))).not.toBeNull();
  });

  it('fails CLOSED when the secret is empty', () => {
    process.env.NODE_ENV = 'development';
    process.env.LOCAL_DEV_SECRET = '';
    expect(devOnlyGuard(req({ 'x-local-dev': '' }))).not.toBeNull();
  });

  it('rejects a missing, wrong, or partial secret', () => {
    process.env.NODE_ENV = 'development';
    process.env.LOCAL_DEV_SECRET = 'correct-secret';
    for (const headers of [
      {},
      { 'x-local-dev': '' },
      { 'x-local-dev': 'wrong' },
      { 'x-local-dev': 'correct' }, // prefix - must not pass
      { 'x-local-dev': 'correct-secretX' }, // suffix - must not pass
    ]) {
      expect(devOnlyGuard(req(headers)), JSON.stringify(headers)).not.toBeNull();
    }
  });

  it('admits a genuine developer in development with the right secret', () => {
    process.env.NODE_ENV = 'development';
    process.env.LOCAL_DEV_SECRET = 'correct-secret';
    // null means "safe to continue" - the caller then runs the dev flow.
    expect(devOnlyGuard(req({ 'x-local-dev': 'correct-secret' }))).toBeNull();
  });
});

describe('mock payment + e-sign dev routes are wired to the guard', () => {
  it('no dev-only route still relies on a bare NODE_ENV check', async () => {
    const { scanSource, readSource } = await import('@/app/api/__tests__/security/_sourceScan');
    const devRoutes = [
      'app/api/payments/mock-checkout/route.ts',
      'app/api/payments/mock-checkout/complete/route.ts',
      'app/api/esign/mock-sign/route.ts',
    ];
    for (const rel of devRoutes) {
      const src = readSource(`${process.cwd()}/src/${rel}`);
      expect(src, `${rel} must use the shared guard`).toContain('devOnlyGuard(request)');
      expect(src, `${rel} must import the guard`).toContain('devOnlyRoute');
    }
    // A bare NODE_ENV comparison left behind would mean someone re-introduced
    // the single-variable barrier next to the real one.
    const all = scanSource(`${process.cwd()}/src/app/api`, { onlyFile: 'route.ts' });
    for (const file of all) {
      const src = readSource(file);
      if (!/mock-checkout|mock-sign/.test(file)) continue;
      expect(
        /if\s*\(process\.env\.NODE_ENV\s*===?\s*'production'\)/.test(src),
        `${file} still has a bare NODE_ENV production check`
      ).toBe(false);
    }
  });
});
