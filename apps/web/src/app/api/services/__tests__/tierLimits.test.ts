/**
 * Tests for tier-based usage limit enforcement.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the sql module
vi.mock('@/app/api/utils/sql', () => ({
  default: vi.fn(),
}));

// Mock the usage tracker
vi.mock('../usageTracker', () => ({
  getCurrentUsage: vi.fn(),
  recordUsage: vi.fn(),
}));

import sql from '@/app/api/utils/sql';
import { getCurrentUsage } from '../usageTracker';
import {
  getSubscription,
  checkLimit,
  getUsageSummary,
  type SubscriptionInfo,
} from '../tierLimits';

describe('tierLimits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getSubscription', () => {
    it('returns active subscription when found', async () => {
      const mockSub = {
        plan_id: 'plan_starter',
        plan_name: 'Starter',
        tier: 'starter',
        status: 'active',
        limits: {
          monthly_lead_allowance: 1000,
          monthly_sms_allowance: 500,
          campaigns: 1,
        },
      };

      (sql as any).mockResolvedValueOnce([mockSub]);

      const result = await getSubscription('org_123');

      expect(result.planId).toBe('plan_starter');
      expect(result.tier).toBe('starter');
      expect(result.isFreeTier).toBe(false);
    });

    it('returns free tier when no subscription found', async () => {
      // No subscription found
      (sql as any).mockResolvedValueOnce([]);
      // Free plan lookup
      (sql as any).mockResolvedValueOnce([
        {
          plan_id: 'plan_free',
          plan_name: 'Free',
          tier: 'free',
          limits: {
            monthly_lead_allowance: 10,
            is_free_tier: true,
          },
        },
      ]);

      const result = await getSubscription('org_123');

      expect(result.tier).toBe('free');
      expect(result.isFreeTier).toBe(true);
      expect(result.limits.monthly_lead_allowance).toBe(10);
    });

    it('returns hardcoded free tier as absolute fallback', async () => {
      (sql as any).mockResolvedValueOnce([]);
      (sql as any).mockResolvedValueOnce([]);

      const result = await getSubscription('org_123');

      expect(result.tier).toBe('free');
      expect(result.isFreeTier).toBe(true);
      expect(result.limits.monthly_lead_allowance).toBe(10);
    });
  });

  describe('checkLimit', () => {
    it('allows action when under limit', async () => {
      // Mock subscription lookup
      (sql as any).mockResolvedValueOnce([
        {
          plan_id: 'plan_free',
          plan_name: 'Free',
          tier: 'free',
          status: 'active',
          limits: {
            monthly_lead_allowance: 10,
            is_free_tier: true,
          },
        },
      ]);

      // Mock lead count query
      (sql as any).mockResolvedValueOnce([{ count: 5 }]);

      const result = await checkLimit('org_123', 'lead');

      expect(result.allowed).toBe(true);
      expect(result.current).toBe(5);
      expect(result.limit).toBe(10);
      expect(result.remaining).toBe(5);
      expect(result.percentUsed).toBe(50);
    });

    it('denies action when at limit', async () => {
      (sql as any).mockResolvedValueOnce([
        {
          plan_id: 'plan_free',
          plan_name: 'Free',
          tier: 'free',
          status: 'active',
          limits: {
            monthly_lead_allowance: 10,
            is_free_tier: true,
          },
        },
      ]);

      (sql as any).mockResolvedValueOnce([{ count: 10 }]);

      const result = await checkLimit('org_123', 'lead');

      expect(result.allowed).toBe(false);
      expect(result.current).toBe(10);
      expect(result.limit).toBe(10);
      expect(result.remaining).toBe(0);
      expect(result.message).toBeDefined();
      expect(result.upgradeReason).toBeDefined();
    });

    it('denies action when would exceed limit', async () => {
      (sql as any).mockResolvedValueOnce([
        {
          plan_id: 'plan_free',
          plan_name: 'Free',
          tier: 'free',
          status: 'active',
          limits: {
            monthly_sms_allowance: 25,
            is_free_tier: true,
          },
        },
      ]);

      (getCurrentUsage as any).mockResolvedValueOnce(20);

      const result = await checkLimit('org_123', 'sms', 10);

      expect(result.allowed).toBe(false);
      expect(result.current).toBe(20);
      expect(result.limit).toBe(25);
    });

    it('allows unlimited metrics', async () => {
      (sql as any).mockResolvedValueOnce([
        {
          plan_id: 'plan_professional',
          plan_name: 'Professional',
          tier: 'professional',
          status: 'active',
          limits: {
            campaigns: -1, // Unlimited
          },
        },
      ]);

      (sql as any).mockResolvedValueOnce([{ count: 100 }]);

      const result = await checkLimit('org_123', 'campaign');

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(-1);
      expect(result.remaining).toBe(Infinity);
    });

    it('shows approaching limit message at 80%', async () => {
      (sql as any).mockResolvedValueOnce([
        {
          plan_id: 'plan_free',
          plan_name: 'Free',
          tier: 'free',
          status: 'active',
          limits: {
            monthly_lead_allowance: 10,
            is_free_tier: true,
          },
        },
      ]);

      (sql as any).mockResolvedValueOnce([{ count: 8 }]);

      const result = await checkLimit('org_123', 'lead');

      expect(result.allowed).toBe(true);
      expect(result.percentUsed).toBe(80);
      expect(result.message).toBeDefined();
      expect(result.message).toContain('remaining');
    });
  });

  describe('getUsageSummary', () => {
    it('returns summary for all metrics', async () => {
      // For each metric check, the function will call getSubscription and getMetricUsage
      // We need to mock multiple calls
      const mockSubscription = {
        id: 'sub_123',
        plan_id: 'plan_free',
        plan_name: 'Free',
        tier: 'free',
        status: 'active',
        trial_ends_at: null,
        limits: {
          monthly_lead_allowance: 10,
          monthly_sms_allowance: 25,
          monthly_email_allowance: 50,
          ai_request_allowance: 10,
          campaigns: 1,
          seats: 1,
          api_rate_limit_per_minute: 10,
          automation_limit: 1,
          workflow_limit: 1,
          is_free_tier: true,
        },
      };

      // getUsageSummary calls checkLimit for each of: lead, campaign, sms, email, ai_request
      // - lead: getSubscription (1 sql) + SQL count query (1 sql)
      // - campaign: getSubscription (1 sql) + SQL count query (1 sql)
      // - sms: getSubscription (1 sql) + getCurrentUsage (mocked)
      // - email: getSubscription (1 sql) + getCurrentUsage (mocked)
      // - ai_request: getSubscription (1 sql) + getCurrentUsage (mocked)
      // Total SQL calls: 5 subscription + 2 count = 7

      // Mock subscription lookups (5 calls)
      (sql as any).mockResolvedValueOnce([mockSubscription]); // lead subscription
      (sql as any).mockResolvedValueOnce([{ count: 0 }]);     // lead count
      (sql as any).mockResolvedValueOnce([mockSubscription]); // campaign subscription
      (sql as any).mockResolvedValueOnce([{ count: 0 }]);     // campaign count
      (sql as any).mockResolvedValueOnce([mockSubscription]); // sms subscription
      (sql as any).mockResolvedValueOnce([mockSubscription]); // email subscription
      (sql as any).mockResolvedValueOnce([mockSubscription]); // ai_request subscription

      // Mock getCurrentUsage for sms, email, ai_request
      (getCurrentUsage as any).mockResolvedValue(0);

      const result = await getUsageSummary('org_123');

      expect(result.lead).toBeDefined();
      expect(result.campaign).toBeDefined();
      expect(result.sms).toBeDefined();
      expect(result.email).toBeDefined();
      expect(result.ai_request).toBeDefined();
    });
  });
});
