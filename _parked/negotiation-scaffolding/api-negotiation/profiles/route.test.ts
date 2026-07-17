import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from './route';
import { sql } from '@/app/api/utils/sql';

vi.mock('@/app/api/utils/sql', () => ({
  sql: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

import { auth } from '@/lib/auth';

function mockSession(userId = 'user-1') {
  (auth.api.getSession as any).mockResolvedValue({ user: { id: userId } });
}

function request(body: any) {
  return new NextRequest('http://localhost/api/negotiation/profiles', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('Negotiation Profiles API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET returns all active profiles', async () => {
    mockSession();
    (sql as any).mockResolvedValue([
      { id: 1, name: 'Standard Wholesale', slug: 'standard-wholesale', is_active: true },
      { id: 2, name: 'Luxury Wholesale', slug: 'luxury-wholesale', is_active: true },
    ]);

    const res = await GET(new NextRequest('http://localhost/api/negotiation/profiles'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.profiles).toHaveLength(2);
    expect(json.profiles[0].slug).toBe('standard-wholesale');
  });

  it('POST creates a profile with required fields', async () => {
    mockSession();
    (sql as any).mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 3 }]);

    const res = await POST(request({
      name: 'Custom Profile',
      slug: 'custom-profile',
      targetPurchasePct: 0.65,
      maxPurchasePct: 0.75,
      minPurchasePct: 0.55,
    }));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.profile.id).toBe(3);
  });

  it('POST rejects missing required fields', async () => {
    mockSession();

    const res = await POST(request({ name: 'Incomplete' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('required');
  });

  it('POST rejects invalid percentage ranges', async () => {
    mockSession();

    const res = await POST(request({
      name: 'Bad',
      slug: 'bad',
      targetPurchasePct: 0.9,
      maxPurchasePct: 0.8,
      minPurchasePct: 0.7,
    }));
    const json = await res.json();

    expect(res.status).toBe(400);
  });
});