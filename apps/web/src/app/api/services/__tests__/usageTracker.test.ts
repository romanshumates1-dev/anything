import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to define mock functions that vi.mock can access
const mockSql = vi.hoisted(() => vi.fn(async () => []));
const mockLogEvent = vi.hoisted(() => vi.fn());

vi.mock('@/app/api/utils/sql', () => ({
  default: mockSql
}));

vi.mock('@/app/api/utils/logger', () => ({
  logEvent: mockLogEvent
}));

// Import after mocking
import { checkUsageLimit, getCurrentUsage, getPlanLimit } from '@/app/api/services/usageTracker';

describe('usageTracker', () => {
  beforeEach(() => {
    mockSql.mockClear();
    mockLogEvent.mockClear();
  });

  describe('getPlanLimit', () => {
    it('returns the limit from the active subscription plan', async () => {
      mockSql.mockResolvedValueOnce([
        { limit_value: '500' }
      ]);

      const limit = await getPlanLimit('org_test', 'sms');
      expect(limit).toBe(500);
    });

    it('returns 0 for organizations without subscription', async () => {
      mockSql.mockResolvedValueOnce([]);

      const limit = await getPlanLimit('org_no_sub', 'sms');
      expect(limit).toBe(0);
    });
  });

  describe('getCurrentUsage', () => {
    it('returns sum of usage for the current period', async () => {
      mockSql.mockResolvedValueOnce([
        { total: '125' }
      ]);

      const usage = await getCurrentUsage('org_test', 'sms');
      expect(usage).toBe(125);
    });

    it('returns 0 when no usage recorded', async () => {
      mockSql.mockResolvedValueOnce([
        { total: null }
      ]);

      const usage = await getCurrentUsage('org_new', 'sms');
      expect(usage).toBe(0);
    });
  });

  describe('checkUsageLimit', () => {
    it('allows usage when under limit', async () => {
      mockSql
        .mockResolvedValueOnce([
          { limit_value: '500' }
        ])
        .mockResolvedValueOnce([
          { total: '100' }
        ])
        .mockResolvedValueOnce([]);

      const result = await checkUsageLimit('org_test', 'sms', 1);
      
      expect(result.allowed).toBe(true);
      expect(result.limit.used).toBe(100);
      expect(result.limit.remaining).toBe(400);
      expect(result.limit.hardLimitReached).toBe(false);
    });

    it('blocks usage when hard limit reached', async () => {
      mockSql
        .mockResolvedValueOnce([
          { limit_value: '500' }
        ])
        .mockResolvedValueOnce([
          { total: '500' }
        ])
        .mockResolvedValueOnce([]);

      const result = await checkUsageLimit('org_test', 'sms', 1);
      
      expect(result.allowed).toBe(false);
      expect(result.limit.hardLimitReached).toBe(true);
    });

    it('flags soft limit when approaching hard limit', async () => {
      mockSql
        .mockResolvedValueOnce([
          { limit_value: '500' }
        ])
        .mockResolvedValueOnce([
          { total: '400' }
        ])
        .mockResolvedValueOnce([]);

      const result = await checkUsageLimit('org_test', 'sms', 1);
      
      expect(result.limit.softLimitReached).toBe(true);
    });

    it('blocks SMS usage when Twilio 10DLC campaign is pending', async () => {
      mockSql
        .mockResolvedValueOnce([
          { limit_value: '500' }
        ])
        .mockResolvedValueOnce([
          { total: '100' }
        ])
        .mockResolvedValueOnce([
          { campaign_status: 'pending' }
        ]);

      const result = await checkUsageLimit('org_test', 'sms', 1);
      
      expect(result.allowed).toBe(false);
      expect(result.message).toContain('10DLC campaign pending');
    });
  });
});