/**
 * getCredits — tier-pricing resilience (F3 follow-through).
 *
 * getAllCosts now FAILS CLOSED for a tier with no credit_costs rows instead of
 * silently serving FREE prices. getCredits must therefore degrade gracefully:
 * a real customer on a drifted subscription_plans tier ('scale' from 067,
 * 'professional' from 035) must still get their balance + history and an empty
 * cost table — NOT a 500 and NOT invented FREE prices.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getAllCosts = vi.fn();
const getBalanceDetails = vi.fn();
const getTransactionHistory = vi.fn();
const getSubscriptionStatus = vi.fn();

vi.mock('@/app/api/utils/sql', () => ({ default: vi.fn() }));
vi.mock('@/app/api/utils/credits', () => ({
  getAllCosts: (...a: any[]) => getAllCosts(...a),
  getBalanceDetails: (...a: any[]) => getBalanceDetails(...a),
  getTransactionHistory: (...a: any[]) => getTransactionHistory(...a),
}));
vi.mock('@/app/api/utils/subscriptionGuard', () => ({
  getSubscriptionStatus: (...a: any[]) => getSubscriptionStatus(...a),
}));
vi.mock('@/app/api/utils/pipelineOrchestrator', () => ({
  getPipelineStatus: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/app/api/utils/queryFallback', () => ({
  logFallback: () => () => undefined,
}));
vi.mock('date-fns', () => ({ formatDistanceToNow: () => 'just now' }));

const { getCredits } = await import('@/app/api/utils/dashboardSlices');

describe('getCredits — tier pricing resilience (F3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBalanceDetails.mockResolvedValue({ balance: 1000, lifetimePurchased: 2000, lifetimeUsed: 1000, updatedAt: new Date() });
    getTransactionHistory.mockResolvedValue([]);
    // Silence the expected console.error in the unknown-tier case.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('known tier: costs are populated and returned', async () => {
    getSubscriptionStatus.mockResolvedValue({ tier: 'pro' });
    getAllCosts.mockResolvedValue({ SMS_SEND: 3, EMAIL_SEND: 1 });

    const payload = await getCredits('org-1', { includeHistory: false });

    expect(payload.balance).toBe(1000);
    expect(payload.tier).toBe('pro');
    expect(payload.costs).toEqual({ SMS_SEND: 3, EMAIL_SEND: 1 });
    expect(getAllCosts).toHaveBeenCalledWith('pro');
  });

  it('unknown/drifted tier: no throw, balance preserved, costs empty (no FREE substitution)', async () => {
    // subscription_plans has 'scale' (067) / 'professional' (035) with no
    // credit_costs rows — getAllCosts throws for them.
    getSubscriptionStatus.mockResolvedValue({ tier: 'scale' });
    getAllCosts.mockRejectedValue(new Error('Unknown subscription tier "scale"'));

    const payload = await getCredits('org-scale', { includeHistory: false });

    expect(payload.balance).toBe(1000); // balance still served — no 500
    expect(payload.tier).toBe('scale');
    expect(payload.costs).toEqual({}); // empty, NOT FREE prices
    // Must not have substituted another tier's pricing.
    expect(getAllCosts).toHaveBeenCalledWith('scale');
    expect(getAllCosts).not.toHaveBeenCalledWith('FREE');
  });

  it('unknown tier still returns transaction history when requested', async () => {
    getSubscriptionStatus.mockResolvedValue({ tier: 'professional' });
    getAllCosts.mockRejectedValue(new Error('Unknown subscription tier "professional"'));
    getTransactionHistory.mockResolvedValue([
      { id: 't1', type: 'PURCHASE', amount: 500, balanceAfter: 1000, description: 'Pack', createdAt: new Date() },
    ]);

    const payload = await getCredits('org-pro', { includeHistory: true });

    expect(payload.balance).toBe(1000);
    expect(payload.costs).toEqual({});
    expect(payload.transactions).toHaveLength(1);
    expect(payload.transactions![0].id).toBe('t1');
  });
});
