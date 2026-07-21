/**
 * Tests for admin organizations endpoint
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import sql from '@/app/api/utils/sql';

vi.mock('@/app/api/utils/sql');
vi.mock('@/app/api/utils/authz', () => ({
  requireAdmin: vi.fn(),
}));
vi.mock('@/app/api/utils/logger', () => ({
  logEvent: vi.fn(),
}));

const mockSql = vi.mocked(sql);
const { requireAdmin } = await import('@/app/api/utils/authz');
const adminRoute = await import('./route');

describe('Admin Organizations API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET', () => {
    it('returns 403 when user is not admin', async () => {
      vi.mocked(requireAdmin).mockResolvedValue({ ok: false, response: new Response('Forbidden', { status: 403 }) });
      
      const response = await adminRoute.GET();
      
      expect(response.status).toBe(403);
    });

    it('returns organizations list when admin', async () => {
      vi.mocked(requireAdmin).mockResolvedValue({ ok: true, userId: 'admin1', email: 'admin@test.com' });
      mockSql.mockResolvedValue([
        { id: 'org1', name: 'Org A', slug: 'org-a', created_at: '2026-01-01', member_count: 5, lead_count: 10, subscription_status: 'active' },
        { id: 'org2', name: 'Org B', slug: 'org-b', created_at: '2026-01-02', member_count: 3, lead_count: 5, subscription_status: 'trial' },
      ]);

      const response = await adminRoute.GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveLength(2);
      expect(data[0].id).toBe('org1');
    });
  });

  describe('PATCH', () => {
    it('returns 400 when org ID missing', async () => {
      vi.mocked(requireAdmin).mockResolvedValue({ ok: true, userId: 'admin1', email: 'admin@test.com' });
      
      const response = await adminRoute.PATCH(new Request('http://test/api/admin/organizations'));
      
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Organization ID required');
    });

    it('returns 404 when organization not found', async () => {
      vi.mocked(requireAdmin).mockResolvedValue({ ok: true, userId: 'admin1', email: 'admin@test.com' });
      mockSql.mockResolvedValue([]);

      const response = await adminRoute.PATCH(
        new Request('http://test/api/admin/organizations?id=org_missing', {
          method: 'PATCH',
          body: JSON.stringify({ name: 'New Name' }),
        })
      );

      expect(response.status).toBe(404);
    });

    it('updates organization name successfully', async () => {
      vi.mocked(requireAdmin).mockResolvedValue({ ok: true, userId: 'admin1', email: 'admin@test.com' });
      mockSql.mockResolvedValue([{ id: 'org1', name: 'Old Name' }]);

      const response = await adminRoute.PATCH(
        new Request('http://test/api/admin/organizations?id=org1', {
          method: 'PATCH',
          body: JSON.stringify({ name: 'New Name' }),
        })
      );

      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });
});