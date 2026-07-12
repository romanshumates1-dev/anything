/**
 * Domain-lock layer 3 — the middleware access gate (behavioral).
 *
 * Every authenticated app page + session-authed API request is checked
 * server-side against the email-domain allowlist and MIN_ACCESS_ROLE:
 *  - out-of-domain session → 403 (API) / redirect to /access-restricted (page)
 *  - allowed-domain MEMBER under the default ADMIN gate → 403 (API) /
 *    redirect to /pending-access (page)
 *  - allowed-domain ADMIN → passthrough
 *  - no session at all → passthrough (routes enforce their own auth; this
 *    layer only ever tightens)
 *  - exempt machine endpoints (webhook, jobs, system, auth) are untouched
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn(async () => [] as any) }));
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

import { enforceAccessGate } from '@/middleware';

function reqWithSession(path: string, token = 'tok123.signature') {
  return new NextRequest(`http://localhost:4000${path}`, {
    headers: { cookie: `better-auth.session_token=${encodeURIComponent(token)}` },
  });
}

function sessionUser(email: string, role: string | null) {
  return [{ email, role }];
}

beforeEach(() => {
  mockSql.mockReset();
  mockSql.mockResolvedValue([]);
});

describe('out-of-domain sessions are rejected everywhere', () => {
  it('page request → redirect to /access-restricted', async () => {
    mockSql.mockResolvedValue(sessionUser('intruder@gmail.com', 'ADMIN'));
    const res = await enforceAccessGate(reqWithSession('/dashboard'));
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get('location')).toContain('/access-restricted');
  });

  it('API request → 403 JSON', async () => {
    mockSql.mockResolvedValue(sessionUser('intruder@gmail.com', 'ADMIN'));
    const res = await enforceAccessGate(reqWithSession('/api/analytics'));
    expect(res.status).toBe(403);
  });

  it('the DB lookup uses the raw token from the signed cookie value', async () => {
    mockSql.mockResolvedValue(sessionUser('intruder@gmail.com', 'ADMIN'));
    await enforceAccessGate(reqWithSession('/dashboard', 'rawtoken.sig-part'));
    expect(mockSql.mock.calls[0]).toContain('rawtoken');
  });
});

describe('role gate (MIN_ACCESS_ROLE default ADMIN)', () => {
  it('allowed-domain MEMBER page request → redirect to /pending-access', async () => {
    mockSql.mockResolvedValue(sessionUser('member@dealswiftautomation.com', 'MEMBER'));
    const res = await enforceAccessGate(reqWithSession('/campaigns'));
    expect(res.headers.get('location')).toContain('/pending-access');
  });

  it('allowed-domain MEMBER API request → 403', async () => {
    mockSql.mockResolvedValue(sessionUser('member@dealswiftautomation.com', 'MEMBER'));
    const res = await enforceAccessGate(reqWithSession('/api/campaigns'));
    expect(res.status).toBe(403);
  });

  it('allowed-domain ADMIN passes through (non-vacuous counterpart)', async () => {
    mockSql.mockResolvedValue(sessionUser('roman.shumate@dealswiftautomation.com', 'ADMIN'));
    const res = await enforceAccessGate(reqWithSession('/dashboard'));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('missing role is treated as below the gate (fail closed)', async () => {
    mockSql.mockResolvedValue(sessionUser('legacy@dealswiftautomation.com', null));
    const res = await enforceAccessGate(reqWithSession('/dashboard'));
    expect(res.headers.get('location')).toContain('/pending-access');
  });
});

describe('deny-only design', () => {
  it('no session cookie → passthrough with no DB call', async () => {
    const res = await enforceAccessGate(new NextRequest('http://localhost:4000/dashboard'));
    expect(res.status).toBe(200);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('cookie present but session row missing/expired → passthrough (route 401s it)', async () => {
    mockSql.mockResolvedValue([]);
    const res = await enforceAccessGate(reqWithSession('/dashboard'));
    expect(res.status).toBe(200);
  });

  it('DB failure → passthrough, never a crash or accidental allow-list bypass', async () => {
    mockSql.mockRejectedValue(new Error('db down'));
    const res = await enforceAccessGate(reqWithSession('/dashboard'));
    expect(res.status).toBe(200);
  });
});

describe('exempt machine endpoints', () => {
  it.each(['/api/auth/get-session', '/api/sms/inbound', '/api/jobs/process', '/api/system/health'])(
    '%s is untouched even with an out-of-domain session',
    async (path) => {
      mockSql.mockResolvedValue(sessionUser('intruder@gmail.com', 'ADMIN'));
      const res = await enforceAccessGate(reqWithSession(path));
      expect(res.status).toBe(200);
      expect(mockSql).not.toHaveBeenCalled();
    }
  );
});

describe('bearer-token sessions (mobile flow) are gated identically', () => {
  it('out-of-domain bearer session → 403 on API', async () => {
    mockSql.mockResolvedValue(sessionUser('intruder@gmail.com', 'ADMIN'));
    const req = new NextRequest('http://localhost:4000/api/analytics', {
      headers: { authorization: 'Bearer tok456.sig' },
    });
    const res = await enforceAccessGate(req);
    expect(res.status).toBe(403);
  });
});
