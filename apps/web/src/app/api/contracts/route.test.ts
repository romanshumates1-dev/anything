/**
 * Tests for GET /api/contracts
 * Covers: auth checks, org scoping, data retrieval
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { default: mockSql } = vi.hoisted(() => {
  const m: any = vi.fn(async () => []);
  m.transaction = vi.fn(async () => []);
  m.query = m;
  return { default: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: (...a: any[]) => getSession(...a) } } }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));

const { getOrganization } = vi.hoisted(() => ({ getOrganization: vi.fn() }));
vi.mock('@/lib/organization-context', () => ({ getOrganization: (...a: any[]) => getOrganization(...a) }));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: 'user-1' } });
  getOrganization.mockResolvedValue({ id: 'org-A' });
});

describe('GET /api/contracts', () => {
  it('401 without session', async () => {
    getSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
  });

  it('403 without organization', async () => {
    getOrganization.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'No organization found' });
  });

  it('returns contracts scoped to organization', async () => {
    const mockContracts = [
      {
        id: 'contract-1',
        direction: 'acquisition',
        status: 'SIGNED',
        signed_at: '2026-09-01',
        created_at: '2026-08-01',
        esign_events: [],
        payment: null,
      },
    ];
    mockSql.mockResolvedValueOnce(mockContracts);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(mockContracts);

    // Verify org scoping in query
    const call = mockSql.mock.calls[0];
    expect(call).toContain('org-A');
  });

  it('returns empty array when no contracts exist', async () => {
    mockSql.mockResolvedValueOnce([]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it('returns 500 on database error', async () => {
    mockSql.mockRejectedValueOnce(new Error('DB error'));
    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal Server Error' });
  });
});
