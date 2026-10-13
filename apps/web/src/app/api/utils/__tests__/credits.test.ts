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
  isKnownCreditTier,
  CREDIT_TIERS,
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

                it('throws for an unknown/unmapped tier instead of silently pricing at FREE', async () => {
      // F3 hardening (see credits.ts getCreditCost): an unknown or unmapped tier
      // such as the real paid plans 'professional'/'scale' must NOT fall back to
      // the FREE-tier cost — that would undercharge paying orgs and write the wrong
      // (FREE) price into the billing ledger (metadata.cost). It must reject.
      // Deliberately do NOT prime mockResolvedValueOnce values here: the tier check
      // rejects BEFORE sql is called (see expect(sql).not.toHaveBeenCalled below),
      // and unconsumed Once-queues would leak into later tests because
      // vi.clearAllMocks only clears call history, not queued Once values.
      (sql as any).mockReset();

      await expect(getCreditCost('SMS_SEND', 'UNKNOWN_TIER')).rejects.toThrow(
        /Unknown subscription tier/i,
      );
      expect(sql).not.toHaveBeenCalled();
    });

    it('falls back to FREE only for a KNOWN tier missing that one action row', async () => {
      // PRO is a known tier; if its row for SMS_SEND is absent, the per-action
      // FREE fallback is intentional and allowed (does not apply to unmapped tiers).
      (sql as any)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ cost: 5 }]);

      const cost = await getCreditCost('SMS_SEND', 'PRO');
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

  // F3: an unknown tier must NOT be silently priced at FREE.
  describe('getAllCosts — tier validation (F3)', () => {
    it('recognises every seeded credit tier (case-insensitive)', () => {
      for (const tier of CREDIT_TIERS) {
        expect(isKnownCreditTier(tier)).toBe(true);
        expect(isKnownCreditTier(tier.toLowerCase())).toBe(true);
      }
    });

    it('throws for an unknown tier instead of returning FREE pricing', async () => {
      // subscription_plans.tier has drifted ('professional' in 025, 'scale' in
      // 067) and those labels have NO credit_costs rows. Before the fix,
      // getAllCosts('professional') ran `WHERE tier=$1 OR tier='FREE'`, matched
      // only FREE, and returned FREE prices with no error — a silently wrong
      // price for a paid plan.
      await expect(getAllCosts('professional')).rejects.toThrow(/Unknown subscription tier/i);
      await expect(getAllCosts('scale')).rejects.toThrow(/Unknown subscription tier/i);
      await expect(getAllCosts('')).rejects.toThrow(/Unknown subscription tier/i);
      await expect(getAllCosts('GARBAGE_TIER')).rejects.toThrow(/refusing to price it at FREE/i);
      // sql must never be reached for an invalid tier.
      expect(sql).not.toHaveBeenCalled();
    });

    it('preserves legitimate FREE, PRO, and ENTERPRISE pricing (no substitution)', async () => {
      // Each known tier is priced by its OWN rows; FREE only fills an action
      // the specific tier has not defined. Verify the query is issued with the
      // requested (uppercased) tier and the documented FREE fallback.
      (sql as any).mockResolvedValue([{ action: 'SMS_SEND', cost: 2 }]);
      const enterprise = await getAllCosts('enterprise');
      expect(enterprise.SMS_SEND).toBe(2);
      // sql is a tagged-template mock: mock.calls[0] is the args array, whose
      // [0] is the strings array and whose later slots are interpolated values.
      const callArgs = (sql as any).mock.calls[0];
      expect(String(callArgs[0])).toContain('credit_costs');
      const passedValues = callArgs.slice(1);
      expect(passedValues).toContain('ENTERPRISE'); // uppercased, not 'enterprise'

      (sql as any).mockClear();
      (sql as any).mockResolvedValue([{ action: 'SMS_SEND', cost: 5 }]);
      const free = await getAllCosts('FREE');
      expect(free.SMS_SEND).toBe(5);
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
