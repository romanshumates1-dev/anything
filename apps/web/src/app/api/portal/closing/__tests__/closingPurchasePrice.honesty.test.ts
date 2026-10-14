/**
 * Closing-portal purchase price — DATA HONESTY regression.
 *
 * `resolveClosingPurchasePrice` returns the buyer-facing purchase price in the
 * closing portal. It used to fabricate `|| 150000` — an invented $150,000 shown
 * to the buyer (and used as the disbursement amount) when the deal's real price
 * was simply not recorded. Same fabricated-data class as SET H2 / R1–R7.
 *
 * Rule: the recorded value or null; nothing invented.
 */
import { describe, it, expect } from 'vitest';
import { resolveClosingPurchasePrice } from '../route';

describe('resolveClosingPurchasePrice — honours recorded values', () => {
  it('divides integer offer_cents into dollars (authoritative source)', () => {
    expect(resolveClosingPurchasePrice(15_000_000, {})).toBe(150000);
  });

  it('falls back to a recorded positive acceptedAmount when offer_cents absent', () => {
    expect(resolveClosingPurchasePrice(null, { acceptedAmount: 132500 })).toBe(132500);
    expect(resolveClosingPurchasePrice(undefined, { acceptedAmount: 90000 })).toBe(90000);
  });

  it('offer_cents wins over acceptedAmount when both present', () => {
    expect(resolveClosingPurchasePrice(20_000_000, { acceptedAmount: 99999 })).toBe(200000);
  });
});

describe('resolveClosingPurchasePrice — never fabricates a price', () => {
  it('returns null (not 150000) when nothing is recorded', () => {
    expect(resolveClosingPurchasePrice(null, {})).toBeNull();
    expect(resolveClosingPurchasePrice(undefined, undefined)).toBeNull();
    expect(resolveClosingPurchasePrice(0, {})).toBeNull(); // 0 cents is "no offer", not $0
  });

  it('treats non-numeric / non-positive / NaN recorded values as unknown', () => {
    expect(resolveClosingPurchasePrice('15000000', {})).toBeNull();
    expect(resolveClosingPurchasePrice(-5, {})).toBeNull();
    expect(resolveClosingPurchasePrice(NaN, {})).toBeNull();
    expect(resolveClosingPurchasePrice(null, { acceptedAmount: '150000' })).toBeNull();
    expect(resolveClosingPurchasePrice(null, { acceptedAmount: -1 })).toBeNull();
    expect(resolveClosingPurchasePrice(null, { acceptedAmount: {} })).toBeNull();
  });
});
