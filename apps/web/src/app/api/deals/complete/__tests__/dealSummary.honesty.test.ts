/**
 * Deal-completion summary — DATA HONESTY regression.
 *
 * `generateSimpleSummary` is the money-facing summary on the buyer→payment→
 * sign→confirm flow: it is returned by GET /api/deals/complete and emailed as
 * the "Assignment Fee" on deal close. It previously INVENTED figures when
 * `deal.metadata` lacked a recorded value — a fabricated $100,000 price,
 * price×1.4 ARV, Math.min(20000, price×0.1) fee, a literal 'Property Address',
 * and a +14-day closing date — then emailed the invented fee as if collected.
 *
 * These tests pin the honest contract: every financial field is either the value
 * the system actually recorded or `null`; nothing is derived from a guess.
 */
import { describe, it, expect } from 'vitest';
import { generateSimpleSummary } from '../route';

const FULL = {
  id: 'deal_1',
  metadata: {
    purchase_price: 120000,
    arv: 200000,
    assignment_fee: 15000,
    property_address: '742 Evergreen Terrace',
    closing_date: '2026-12-01',
  },
};

describe('generateSimpleSummary — honours recorded figures', () => {
  it('uses the recorded numbers exactly when present', () => {
    const s = generateSimpleSummary(FULL);
    expect(s.purchasePrice).toBe(120000);
    expect(s.assignmentFee).toBe(15000);
    expect(s.buyerPays).toBe(135000); // 120000 + 15000
    expect(s.sellerReceives).toBe(120000);
    expect(s.potentialProfit).toBe(65000); // 200000 - 135000
    expect(s.propertyAddress).toBe('742 Evergreen Terrace');
    expect(s.closingDate).toBe('2026-12-01');
    expect(s.hasCompleteFinancials).toBe(true);
  });

  it('falls back to offer_price only when purchase_price is absent', () => {
    const s = generateSimpleSummary({ id: 'd', metadata: { offer_price: 90000, assignment_fee: 10000 } });
    expect(s.purchasePrice).toBe(90000);
    expect(s.buyerPays).toBe(100000);
  });
});

describe('generateSimpleSummary — never invents a figure the system did not record', () => {
  it('returns all-null financials when metadata is empty (no $100000 / 1.4× / fee / +14-day defaults)', () => {
    const s = generateSimpleSummary({ id: 'deal_x', metadata: {} });
    // The exact fabricated values the old code produced:
    //   price 100000, arv 140000, fee min(20000,10000)=10000, buyerPays 110000,
    //   address 'Property Address', closingDate = today+14d.
    expect(s.purchasePrice).toBeNull();
    expect(s.assignmentFee).toBeNull();
    expect(s.buyerPays).toBeNull();
    expect(s.sellerReceives).toBeNull();
    expect(s.potentialProfit).toBeNull();
    expect(s.propertyAddress).toBeNull();
    expect(s.closingDate).toBeNull();
    expect(s.hasCompleteFinancials).toBe(false);
    expect(s.whyGoodDeal).toEqual([]); // no fabricated "You pay $110,000" bullet
  });

  it('no metadata object at all still yields nulls, not a throw', () => {
    const s = generateSimpleSummary({ id: 'deal_none' });
    expect(s.purchasePrice).toBeNull();
    expect(s.assignmentFee).toBeNull();
    expect(s.buyerPays).toBeNull();
    expect(s.hasCompleteFinancials).toBe(false);
  });

  it('buyerPays/profit stay null when any input is missing (no partial fabrication)', () => {
    const priceOnly = generateSimpleSummary({ id: 'd', metadata: { purchase_price: 120000 } });
    expect(priceOnly.purchasePrice).toBe(120000);
    expect(priceOnly.assignmentFee).toBeNull();
    expect(priceOnly.buyerPays).toBeNull(); // cannot sum without the fee
    expect(priceOnly.hasCompleteFinancials).toBe(false);

    const feeOnly = generateSimpleSummary({ id: 'd', metadata: { assignment_fee: 15000 } });
    expect(feeOnly.assignmentFee).toBe(15000);
    expect(feeOnly.purchasePrice).toBeNull();
    expect(feeOnly.buyerPays).toBeNull();
  });

  it('non-numeric recorded values are treated as unknown, not coerced to a number', () => {
    const s = generateSimpleSummary({
      id: 'd',
      metadata: { purchase_price: '120000', assignment_fee: null, arv: {} },
    });
    expect(s.purchasePrice).toBeNull();
    expect(s.assignmentFee).toBeNull();
    expect(s.buyerPays).toBeNull();
    expect(s.hasCompleteFinancials).toBe(false);
  });

  it('whyGoodDeal only asserts figures that exist', () => {
    const s = generateSimpleSummary({ id: 'd', metadata: { purchase_price: 120000, arv: 200000 } });
    // arv present → its bullet appears; no fee → no "You pay $" or "profit" bullet.
    expect(s.whyGoodDeal.some((b) => b.includes('$200,000'))).toBe(true);
    expect(s.whyGoodDeal.some((b) => /You pay \$/.test(b))).toBe(false);
    expect(s.whyGoodDeal.some((b) => /Potential profit/.test(b))).toBe(false);
  });
});
