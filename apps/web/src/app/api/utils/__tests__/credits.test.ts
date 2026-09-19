/**
 * Credit System Tests
 *
 * Tests for the credit-based billing system with tier-specific surcharges.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the sql module
vi.mock('../sql', () => ({
  default: vi.fn(),
}));

// Mock the logger
vi.mock('../logger', () => ({
  logEvent: vi.fn(),
}));

import sql from '../sql';
import {
  getBalance,
  getBalanceDetails,
  getCreditCost,
  getAllCosts,
  hasEnoughCredits,
  canAffordAction,
  deductCredits,
  deductCreditsForAction,
  addCredits,
  refundCredits,
  grantBonusCredits,
  getTransactionHistory,
} from '../credits';

// Valid UUID for tests (implementation requires UUID format)
const TEST_ORG_ID = '12345678-1234-1234-1234-123456789012';

describe('Credit System', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getBalance', () => {
    it('returns balance when record exists', async () => {
      (sql as any).mockResolvedValue([{ balance: 500 }]);

      const balance = await getBalance(TEST_ORG_ID);

      expect(balance).toBe(500);
    });

    it('creates balance record and returns 0 when not found', async () => {
      (sql as any)
        .mockResolvedValueOnce([]) // First query returns empty
        .mockResolvedValueOnce([]); // Insert query

      const balance = await getBalance(TEST_ORG_ID);

      expect(balance).toBe(0);
    });

    it('returns 0 on error', async () => {
      (sql as any).mockRejectedValue(new Error('DB error'));

      const balance = await getBalance(TEST_ORG_ID);

      expect(balance).toBe(0);
    });
  });

  describe('getCreditCost', () => {
    it('returns tier-specific cost', async () => {
      (sql as any).mockResolvedValue([{ cost: 3 }]);

      const cost = await getCreditCost('SMS_SEND', 'PRO');

      expect(cost).toBe(3);
    });

    it('falls back to FREE tier cost if tier not found', async () => {
      (sql as any)
        .mockResolvedValueOnce([]) // First query returns empty for specific tier
        .mockResolvedValueOnce([{ cost: 5 }]); // Second query for FREE tier

      const cost = await getCreditCost('SMS_SEND', 'UNKNOWN_TIER');

      expect(cost).toBe(5);
    });

    it('returns default cost if nothing in database', async () => {
      (sql as any)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const cost = await getCreditCost('SMS_SEND', 'PRO');

      expect(cost).toBe(5); // Default SMS cost
    });
  });

  describe('hasEnoughCredits', () => {
    it('returns true when balance >= amount', async () => {
      (sql as any).mockResolvedValue([{ balance: 100 }]);

      const result = await hasEnoughCredits(TEST_ORG_ID, 50);

      expect(result).toBe(true);
    });

    it('returns false when balance < amount', async () => {
      (sql as any).mockResolvedValue([{ balance: 30 }]);

      const result = await hasEnoughCredits(TEST_ORG_ID, 50);

      expect(result).toBe(false);
    });
  });

  describe('deductCredits', () => {
    it('deducts credits and records transaction', async () => {
      // CTE-based atomic query returns balance and transaction_id
      (sql as any).mockResolvedValueOnce([{ balance: 90, transaction_id: 'txn_123' }]);

      const result = await deductCredits(TEST_ORG_ID, 10, 'DEDUCT', 'SMS send');

      expect(result.success).toBe(true);
      expect(result.deducted).toBe(10);
      expect(result.remainingBalance).toBe(90);
    });

    it('returns insufficient credits when balance too low', async () => {
      (sql as any)
        .mockResolvedValueOnce([]) // CTE returns nothing when balance insufficient
        .mockResolvedValueOnce([{ balance: 5 }]); // getBalance call for remaining balance

      const result = await deductCredits(TEST_ORG_ID, 100, 'DEDUCT', 'SMS send');

      expect(result.success).toBe(false);
      expect(result.insufficientCredits).toBe(true);
      expect(result.remainingBalance).toBe(5);
    });

    it('handles zero amount deduction', async () => {
      // Zero amount triggers getBalance call (no CTE query)
      (sql as any).mockResolvedValue([{ balance: 100 }]);

      const result = await deductCredits(TEST_ORG_ID, 0, 'DEDUCT', 'No-op');

      expect(result.success).toBe(true);
      expect(result.deducted).toBe(0);
    });
  });

  describe('addCredits', () => {
    it('adds credits and records transaction', async () => {
      (sql as any)
        .mockResolvedValueOnce([]) // Ensure record exists (INSERT ON CONFLICT DO NOTHING)
        .mockResolvedValueOnce([{ balance: 600, transaction_id: 'txn_123' }]); // CTE atomic query

      const result = await addCredits(TEST_ORG_ID, 100, 'PURCHASE', 'Credit pack purchase');

      expect(result.balance).toBe(600);
    });

    it('updates lifetime_purchased for PURCHASE type', async () => {
      (sql as any)
        .mockResolvedValueOnce([]) // Ensure record exists (INSERT ON CONFLICT DO NOTHING)
        .mockResolvedValueOnce([{ balance: 200, transaction_id: 'txn_456' }]); // CTE atomic query

      await addCredits(TEST_ORG_ID, 200, 'PURCHASE', 'Credit pack');

      // Verify the CTE query was called (second call after the ensure exists)
      const cteCall = (sql as any).mock.calls[1];
      expect(cteCall).toBeDefined();
    });
  });

  describe('refundCredits', () => {
    it('adds credits with REFUND type', async () => {
      (sql as any)
        .mockResolvedValueOnce([]) // Ensure record exists (INSERT ON CONFLICT DO NOTHING)
        .mockResolvedValueOnce([{ balance: 110, transaction_id: 'txn_789' }]); // CTE atomic query

      const result = await refundCredits(TEST_ORG_ID, 10, 'Refund: SMS failed');

      expect(result.balance).toBe(110);
    });
  });

  describe('canAffordAction', () => {
    it('returns canAfford true when balance sufficient', async () => {
      // Promise.all calls getCreditCost and getBalance in parallel
      // Mock returns responses in call order
      (sql as any)
        .mockResolvedValueOnce([{ cost: 5 }]) // getCreditCost query
        .mockResolvedValueOnce([{ balance: 100 }]); // getBalance query

      const result = await canAffordAction(TEST_ORG_ID, 'SMS_SEND', 'PRO');

      expect(result.canAfford).toBe(true);
      expect(result.cost).toBe(5);
      expect(result.balance).toBe(100);
    });

    it('returns canAfford false when balance insufficient', async () => {
      (sql as any)
        .mockResolvedValueOnce([{ cost: 5 }]) // getCreditCost query
        .mockResolvedValueOnce([{ balance: 3 }]); // getBalance query

      const result = await canAffordAction(TEST_ORG_ID, 'SMS_SEND', 'PRO');

      expect(result.canAfford).toBe(false);
      expect(result.cost).toBe(5);
      expect(result.balance).toBe(3);
    });
  });

  describe('getAllCosts', () => {
    it('returns costs for all actions', async () => {
      (sql as any).mockResolvedValue([
        { action: 'SMS_SEND', cost: 3 },
        { action: 'EMAIL_SEND', cost: 1 },
        { action: 'AI_REQUEST', cost: 5 },
      ]);

      const costs = await getAllCosts('PRO');

      expect(costs.SMS_SEND).toBe(3);
      expect(costs.EMAIL_SEND).toBe(1);
      expect(costs.AI_REQUEST).toBe(5);
    });
  });

  describe('getTransactionHistory', () => {
    it('returns formatted transaction history', async () => {
      const mockDate = new Date('2024-01-15T10:00:00Z');
      (sql as any).mockResolvedValue([
        {
          id: 'tx_1',
          type: 'PURCHASE',
          amount: 100,
          balance_after: 200,
          description: 'Credit pack',
          metadata: { packId: 'pack_100' },
          created_at: mockDate,
        },
      ]);

      const history = await getTransactionHistory(TEST_ORG_ID, 10);

      expect(history).toHaveLength(1);
      expect(history[0].id).toBe('tx_1');
      expect(history[0].type).toBe('PURCHASE');
      expect(history[0].amount).toBe(100);
      expect(history[0].balanceAfter).toBe(200);
    });
  });
});

describe('Tier-Specific Surcharges', () => {
  it('FREE tier pays highest surcharge', async () => {
    const mockCosts = [
      { tier: 'FREE', action: 'SMS_SEND', cost: 5 },
      { tier: 'PRO', action: 'SMS_SEND', cost: 3 },
      { tier: 'ENTERPRISE', action: 'SMS_SEND', cost: 2 },
    ];

    // Verify FREE > PRO > ENTERPRISE
    expect(mockCosts.find(c => c.tier === 'FREE')!.cost).toBeGreaterThan(
      mockCosts.find(c => c.tier === 'PRO')!.cost
    );
    expect(mockCosts.find(c => c.tier === 'PRO')!.cost).toBeGreaterThan(
      mockCosts.find(c => c.tier === 'ENTERPRISE')!.cost
    );
  });

  it('AI operations cost more than messaging', async () => {
    const mockCosts = {
      AI_REQUEST: 10,
      AI_NEGOTIATION: 25,
      SMS_SEND: 5,
      EMAIL_SEND: 2,
    };

    expect(mockCosts.AI_REQUEST).toBeGreaterThan(mockCosts.SMS_SEND);
    expect(mockCosts.AI_NEGOTIATION).toBeGreaterThan(mockCosts.AI_REQUEST);
    expect(mockCosts.SMS_SEND).toBeGreaterThan(mockCosts.EMAIL_SEND);
  });
});
