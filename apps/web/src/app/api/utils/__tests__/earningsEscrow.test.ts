/**
 * Earnings Escrow Engine Tests
 *
 * Tests the lifecycle of earnings from deals with escrow hold periods.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock sql module
const mockSql = vi.fn();
vi.mock('@/app/api/utils/sql', () => ({
  default: mockSql,
}));

// Mock jobs module
const mockEnqueueJob = vi.fn();
vi.mock('@/app/api/utils/jobs', () => ({
  enqueueJob: mockEnqueueJob,
}));

describe('earningsEscrow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSql.mockReset();
    mockEnqueueJob.mockReset();
  });

  describe('createEarningForDeal', () => {
    it('creates earning with PENDING status and schedules release job', async () => {
      // Mock no existing earning
      mockSql.mockResolvedValueOnce([]);
      // Mock insert success
      mockSql.mockResolvedValueOnce([]);
      // Mock enqueue success
      mockEnqueueJob.mockResolvedValueOnce('job_123');

      const { createEarningForDeal } = await import('../earningsEscrow');

      const result = await createEarningForDeal({
        userId: 'user_1',
        organizationId: 'org_1',
        contractId: 'contract_1',
        amountCents: 500000, // $5,000
        holdDays: 14,
      });

      expect(result.earningId).toMatch(/^earn_/);
      expect(result.availableAt).toBeDefined();

      // Verify job was enqueued for release
      expect(mockEnqueueJob).toHaveBeenCalledWith(
        'release_earning',
        expect.objectContaining({ earningId: result.earningId }),
        expect.objectContaining({
          runAt: result.availableAt,
          dedupeKey: expect.stringContaining('release_earning:'),
        })
      );
    });

    it('throws error if earning already exists for contract', async () => {
      // Mock existing earning found
      mockSql.mockResolvedValueOnce([{ id: 'earn_existing' }]);

      const { createEarningForDeal } = await import('../earningsEscrow');

      await expect(
        createEarningForDeal({
          userId: 'user_1',
          organizationId: 'org_1',
          contractId: 'contract_1',
          amountCents: 500000,
        })
      ).rejects.toThrow('Earning already exists');
    });

    it('uses default 14-day hold period when not specified', async () => {
      mockSql.mockResolvedValueOnce([]);
      mockSql.mockResolvedValueOnce([]);
      mockEnqueueJob.mockResolvedValueOnce('job_123');

      const { createEarningForDeal } = await import('../earningsEscrow');

      const result = await createEarningForDeal({
        userId: 'user_1',
        organizationId: 'org_1',
        contractId: 'contract_1',
        amountCents: 500000,
      });

      const now = Date.now();
      const availableAt = new Date(result.availableAt).getTime();
      const expectedMs = 14 * 24 * 60 * 60 * 1000;

      // Allow 5 second tolerance for test execution time
      expect(availableAt - now).toBeGreaterThan(expectedMs - 5000);
      expect(availableAt - now).toBeLessThan(expectedMs + 5000);
    });
  });

  describe('releaseEarning', () => {
    it('moves PENDING earning to AVAILABLE when available_at has passed', async () => {
      const pastDate = new Date(Date.now() - 1000);
      mockSql.mockResolvedValueOnce([{
        id: 'earn_1',
        status: 'PENDING',
        available_at: pastDate.toISOString(),
      }]);
      mockSql.mockResolvedValueOnce([]);

      const { releaseEarning } = await import('../earningsEscrow');

      const result = await releaseEarning('earn_1');

      expect(result).toBe(true);
    });

    it('does not release if available_at is in the future', async () => {
      const futureDate = new Date(Date.now() + 86400000); // +1 day
      mockSql.mockResolvedValueOnce([{
        id: 'earn_1',
        status: 'PENDING',
        available_at: futureDate.toISOString(),
      }]);

      const { releaseEarning } = await import('../earningsEscrow');

      const result = await releaseEarning('earn_1');

      expect(result).toBe(false);
    });

    it('does not release if earning is not PENDING', async () => {
      mockSql.mockResolvedValueOnce([{
        id: 'earn_1',
        status: 'AVAILABLE', // Already released
        available_at: new Date().toISOString(),
      }]);

      const { releaseEarning } = await import('../earningsEscrow');

      const result = await releaseEarning('earn_1');

      expect(result).toBe(false);
    });

    it('returns false if earning not found', async () => {
      mockSql.mockResolvedValueOnce([]);

      const { releaseEarning } = await import('../earningsEscrow');

      const result = await releaseEarning('earn_nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('refundEarning', () => {
    it('marks PENDING earning as REFUNDED', async () => {
      mockSql.mockResolvedValueOnce([{
        id: 'earn_1',
        status: 'PENDING',
        amount_cents: 500000,
        contract_id: 'contract_1',
      }]);
      mockSql.mockResolvedValueOnce([]);
      mockSql.mockResolvedValueOnce([]);

      const { refundEarning } = await import('../earningsEscrow');

      const result = await refundEarning('earn_1', 'Deal fell through', 'user_1');

      expect(result).toBe(true);
    });

    it('throws error if earning is AVAILABLE (cannot refund after inspection)', async () => {
      mockSql.mockResolvedValueOnce([{
        id: 'earn_1',
        status: 'AVAILABLE',
        amount_cents: 500000,
      }]);

      const { refundEarning } = await import('../earningsEscrow');

      await expect(
        refundEarning('earn_1', 'Deal fell through', 'user_1')
      ).rejects.toThrow('Cannot refund earning with status AVAILABLE');
    });

    it('returns false if earning not found', async () => {
      mockSql.mockResolvedValueOnce([]);

      const { refundEarning } = await import('../earningsEscrow');

      const result = await refundEarning('earn_nonexistent', 'Reason', 'user_1');

      expect(result).toBe(false);
    });
  });

  describe('getUserBalanceSummary', () => {
    it('returns balance breakdown by status', async () => {
      mockSql.mockResolvedValueOnce([{
        pending: 500000n, // $5,000
        available: 250000n, // $2,500
        withdrawn: 1000000n, // $10,000
        refunded: 100000n, // $1,000
        total_earned: 1250000n, // $12,500
      }]);

      const { getUserBalanceSummary } = await import('../earningsEscrow');

      const result = await getUserBalanceSummary('user_1', 'org_1');

      expect(result.pending).toBe(500000);
      expect(result.available).toBe(250000);
      expect(result.withdrawn).toBe(1000000);
      expect(result.refunded).toBe(100000);
      expect(result.totalEarned).toBe(1250000);
    });

    it('returns zeros when no earnings exist', async () => {
      mockSql.mockResolvedValueOnce([{
        pending: 0n,
        available: 0n,
        withdrawn: 0n,
        refunded: 0n,
        total_earned: 0n,
      }]);

      const { getUserBalanceSummary } = await import('../earningsEscrow');

      const result = await getUserBalanceSummary('user_1', 'org_1');

      expect(result.pending).toBe(0);
      expect(result.available).toBe(0);
      expect(result.withdrawn).toBe(0);
      expect(result.refunded).toBe(0);
      expect(result.totalEarned).toBe(0);
    });
  });
});
