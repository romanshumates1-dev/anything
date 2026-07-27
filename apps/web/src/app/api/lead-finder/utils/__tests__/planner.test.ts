/**
 * planner — campaign sizing math ("how many leads to close N deals?").
 * Pure functions, no DB. Arithmetic is asserted to the decimal.
 */
import { describe, it, expect } from 'vitest';
import {
  sizeCampaign,
  checkInventory,
  observedSellerFunnel,
  DEFAULT_SELLER_FUNNEL,
  DEFAULT_BUYER_FUNNEL,
  MIN_OBSERVED_DEALS,
} from '../planner';

describe('sizeCampaign — seller sizing', () => {
  it('lands near the ~6,000-per-deal working figure with default rates', () => {
    const r = sizeCampaign({ targetDeals: 1 });
    // 0.92 * 0.06 * 0.35 * 0.30 * 0.12 * 0.25 = 1.7388e-4
    //   1 / 1.7388e-4 = 5751.09...  ->  ceil = 5752
    // (5751 contacts yields 0.99998 deals — the ceil is load-bearing, not cosmetic.)
    expect(r.sellerConversion).toBeCloseTo(0.00017388, 10);
    expect(r.sellersPerDeal).toBe(5752);
    expect(r.sellersNeeded).toBe(5752);
  });

  it('lands on exactly 100 buyers per deal with default rates', () => {
    // 0.20 * 0.25 * 0.20 = 0.01  ->  1/0.01 = 100
    const r = sizeCampaign({ targetDeals: 1 });
    expect(r.buyerConversion).toBeCloseTo(0.01, 12);
    expect(r.buyersPerDeal).toBe(100);
    expect(r.buyersNeeded).toBe(100);
  });

  it('scales linearly with the deal target', () => {
    const one = sizeCampaign({ targetDeals: 1 });
    const five = sizeCampaign({ targetDeals: 5 });
    expect(five.sellersNeeded).toBe(Math.ceil(one.sellerConversion ** -1 * 5));
    expect(five.buyersNeeded).toBe(500);
  });

  it('rounds UP once at the end, not per stage', () => {
    // Per-stage rounding would compound upward and inflate the ask.
    const r = sizeCampaign({ targetDeals: 1, seller: { deliverability: 0.999 } });
    const exact = 1 / r.sellerConversion;
    expect(r.sellersNeeded).toBe(Math.ceil(exact));
    expect(r.sellersNeeded - exact).toBeLessThan(1);
  });

  it('honours per-stage overrides', () => {
    const better = sizeCampaign({ targetDeals: 1, seller: { replyRate: 0.12 } });
    const base = sizeCampaign({ targetDeals: 1 });
    // Doubling reply rate should roughly halve the contacts needed.
    expect(better.sellersNeeded).toBeCloseTo(base.sellersNeeded / 2, -1);
  });
});

describe('sizeCampaign — stage walk-down', () => {
  it('walks the ACTUAL starting volume down to the deal target', () => {
    const r = sizeCampaign({ targetDeals: 1 });
    expect(r.sellerStages.map((s) => s.stage)).toEqual([
      'delivered',
      'replied',
      'engaged',
      'offer_discussed',
      'under_contract',
      'closed',
    ]);
    // The final stage must reconcile to the requested deals (within rounding).
    const last = r.sellerStages[r.sellerStages.length - 1];
    expect(last.remaining).toBeGreaterThanOrEqual(1);
    expect(last.remaining).toBeLessThan(1.01);
  });

  it('each stage is strictly smaller than the one before it', () => {
    const r = sizeCampaign({ targetDeals: 3 });
    const rem = r.sellerStages.map((s) => s.remaining);
    for (let i = 1; i < rem.length; i++) expect(rem[i]).toBeLessThan(rem[i - 1]);
  });
});

describe('sizeCampaign — input validation', () => {
  it('rejects a non-positive deal target', () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(() => sizeCampaign({ targetDeals: bad })).toThrow(/targetDeals/);
    }
  });

  it('rejects a zero rate — it would imply an infinite funnel', () => {
    expect(() => sizeCampaign({ targetDeals: 1, seller: { replyRate: 0 } })).toThrow(
      /replyRate.*\(0, 1\]/
    );
  });

  it('rejects a rate above 1', () => {
    expect(() => sizeCampaign({ targetDeals: 1, buyer: { takeRate: 1.5 } })).toThrow(/takeRate/);
  });

  it('accepts a rate of exactly 1', () => {
    expect(() => sizeCampaign({ targetDeals: 1, seller: { deliverability: 1 } })).not.toThrow();
  });
});

describe('checkInventory', () => {
  it('reports a shortfall when inventory is short', () => {
    expect(checkInventory(6000, 1200)).toEqual({
      requested: 6000,
      available: 1200,
      shortfall: 4800,
      feasible: false,
    });
  });

  it('is feasible with exactly enough', () => {
    expect(checkInventory(100, 100)).toEqual({
      requested: 100,
      available: 100,
      shortfall: 0,
      feasible: true,
    });
  });

  it('never reports a negative shortfall on surplus', () => {
    expect(checkInventory(100, 5000)).toEqual({
      requested: 100,
      available: 5000,
      shortfall: 0,
      feasible: true,
    });
  });
});

describe('observedSellerFunnel', () => {
  const plenty = {
    sent: 60000,
    delivered: 55000,
    replied: 3300,
    engaged: 1150,
    offerDiscussed: 345,
    underContract: 41,
    closed: 30,
  };

  it('REFUSES observed rates below the minimum sample and says why', () => {
    const r = observedSellerFunnel({ ...plenty, closed: 2 });
    expect(r.usable).toBe(false);
    expect(r.reason).toMatch(/only 2 observed closes/);
    expect(r.funnel).toEqual(DEFAULT_SELLER_FUNNEL);
  });

  it('accepts at exactly the minimum sample', () => {
    const r = observedSellerFunnel({ ...plenty, closed: MIN_OBSERVED_DEALS });
    expect(r.usable).toBe(true);
  });

  it('derives per-stage rates from real counts', () => {
    const r = observedSellerFunnel(plenty);
    expect(r.usable).toBe(true);
    expect(r.funnel.deliverability).toBeCloseTo(55000 / 60000, 10);
    expect(r.funnel.replyRate).toBeCloseTo(3300 / 55000, 10);
    expect(r.funnel.closeRate).toBeCloseTo(30 / 41, 10);
  });

  it('refuses rather than emitting Infinity when a stage has no volume', () => {
    const r = observedSellerFunnel({ ...plenty, engaged: 0 });
    expect(r.usable).toBe(false);
    expect(r.reason).toMatch(/no volume/);
    expect(Number.isFinite(r.funnel.engagedRate)).toBe(true);
  });

  it('a usable observed funnel feeds straight back into sizeCampaign', () => {
    const r = observedSellerFunnel(plenty);
    const sized = sizeCampaign({ targetDeals: 1, seller: r.funnel });
    expect(Number.isFinite(sized.sellersNeeded)).toBe(true);
    expect(sized.sellersNeeded).toBeGreaterThan(0);
  });
});

describe('defaults are internally consistent', () => {
  it('every default rate is a valid probability', () => {
    for (const [k, v] of Object.entries({ ...DEFAULT_SELLER_FUNNEL, ...DEFAULT_BUYER_FUNNEL })) {
      expect(v, k).toBeGreaterThan(0);
      expect(v, k).toBeLessThanOrEqual(1);
    }
  });
});
