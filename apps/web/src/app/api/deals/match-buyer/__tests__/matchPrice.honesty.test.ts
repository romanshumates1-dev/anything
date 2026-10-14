/**
 * Buyer-match price resolution — DATA HONESTY regression.
 *
 * `resolveMatchPrice` decides the price emailed to matched buyers. It used to
 * fall back to `|| 100000`, so buyer matching EMAILED real buyers a
 * "New Deal Available: Purchase: $100,000 + Assignment: $X" for a deal whose
 * price was never recorded — invented money in a customer-facing opportunity
 * email. Same fabricated-data class as SET H2 / R1–R7.
 *
 * Rule: the recorded purchase_price/offer_price or null; nothing invented.
 */
import { describe, it, expect } from 'vitest';
import { resolveMatchPrice } from '../route';

describe('resolveMatchPrice — honours recorded values', () => {
  it('returns purchase_price when recorded', () => {
    expect(resolveMatchPrice({ purchase_price: 120000 })).toBe(120000);
  });
  it('falls back to offer_price when purchase_price absent', () => {
    expect(resolveMatchPrice({ offer_price: 95000 })).toBe(95000);
  });
  it('purchase_price wins over offer_price when both present', () => {
    expect(resolveMatchPrice({ purchase_price: 120000, offer_price: 95000 })).toBe(120000);
  });
  it('coerces numeric strings (metadata is untyped JSON)', () => {
    expect(resolveMatchPrice({ purchase_price: '120000' })).toBe(120000);
  });
});

describe('resolveMatchPrice — never fabricates a price', () => {
  it('returns null (not 100000) when nothing is recorded', () => {
    expect(resolveMatchPrice({})).toBeNull();
    expect(resolveMatchPrice(null)).toBeNull();
    expect(resolveMatchPrice(undefined)).toBeNull();
  });
  it('treats non-positive / NaN / non-numeric values as unknown', () => {
    expect(resolveMatchPrice({ purchase_price: 0 })).toBeNull(); // 0 is "no price", not $0
    expect(resolveMatchPrice({ purchase_price: -5 })).toBeNull();
    expect(resolveMatchPrice({ purchase_price: 'abc' })).toBeNull();
    expect(resolveMatchPrice({ purchase_price: {} })).toBeNull();
    expect(resolveMatchPrice({ purchase_price: null, offer_price: null })).toBeNull();
  });
});
