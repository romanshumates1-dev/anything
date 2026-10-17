/**
 * Earnest-money data-honesty regression.
 *
 * WHAT was wrong
 * ---------------
 * `generate/route.ts` assembled deal data with:
 *   earnest_money: metadata.earnest_money || 1000
 * and `engine.ts` (Texas + generic addendum) repeated:
 *   earnest_money: deal.earnest_money || PURCHASE_AGREEMENT_DEFAULTS.earnest_money
 *
 * So ANY purchase agreement generated for a deal whose earnest money was never
 * negotiated/recorded silently printed **"EARNEST MONEY DEPOSIT: $1,000.00"** and
 * **"BALANCE DUE AT CLOSING: $X,000.00"** (price - 1000) into a legal contract —
 * invented money on a customer-facing legal instrument. This is the same
 * fabricated-data class as SET H2 / R1-R7 and the match-buyer / closing-portal
 * fixes. The prior matrix recorded it as "No action needed"; reconciling
 * against the actual source showed the default was NOT disclosed anywhere in the
 * rendered contract and IS the value every real contract received (no producer
 * writes metadata.earnest_money), so it cannot be treated as a benign edge case.
 *
 * Rule (matches resolveMatchPrice / resolveClosingPurchasePrice):
 *   recorded earnest money value OR fail closed to an un priced "To Be
 *   Negotiated" notice — never a fabricated dollar figure.
 */
import { describe, it, expect } from 'vitest';
import { generatePurchaseAgreement } from '../templates/purchase-agreement';
import { generateTexasAddendum } from '../templates/regional/texas';

function baseVars(overrides: object = {}) {
  return {
    seller_name: 'Jane Seller',
    seller_address: '100 Main St',
    property_address: '100 Main St',
    property_city: 'Phoenix',
    property_state: 'AZ',
    property_zip: '85001',
    property_county: 'Maricopa',
    purchase_price: 150000,
    closing_date: '2026-11-30',
    contract_date: '2026-10-15',
    inspection_days: 14,
    attorney_mod_days: 5,
    ...overrides,
  };
}

describe('earnest_money — never fabricated on a legal contract', () => {
  it('renders the recorded earnest money when present', () => {
    const content = generatePurchaseAgreement(baseVars({ earnest_money: 2500 }));
    expect(content).toContain('EARNEST MONEY DEPOSIT: $2,500.00');
    expect(content).toContain('BALANCE DUE AT CLOSING: $147,500.00'); // 150k - 2500
  });

  it.each([
    ['zero (0 is "no deposit", not $0)', 0],
  ])('does NOT inject $1000 when earnest_money is %s — renders "To Be Negotiated" instead', (_label, value) => {
    const content = generatePurchaseAgreement(baseVars({ earnest_money: value as any }));
    // The fabricated $1,000 must NEVER appear.
    expect(content).not.toContain('$1,000.00');
    expect(content).not.toContain('$1000');
    // Zero earnest money == "not yet negotiated" => honest unpriced notice.
    expect(content).toContain('EARNEST MONEY DEPOSIT: To Be Negotiated (not yet recorded)');
    expect(content).toContain('BALANCE DUE AT CLOSING: To Be Determined');
  });

  it('absent earnest_money (undefined) renders "To Be Negotiated", never $1,000', () => {
    const content = generatePurchaseAgreement(baseVars({ earnest_money: undefined }));
    expect(content).not.toContain('$1,000.00');
    expect(content).not.toContain('$1000');
    expect(content).toContain('EARNEST MONEY DEPOSIT: To Be Negotiated (not yet recorded)');
    expect(content).toContain('BALANCE DUE AT CLOSING: To Be Determined');
  });

  // Present-but-invalid earnest_money (null, negative, NaN, non-numeric) is
  // data corruption, not "absent". The template fails fast (throws) rather than
  // papering over it with a fabricated figure — same fail-closed discipline the
  // purchase_price guard uses (purchase_price <= 0 -> error).
  it.each([
    ['null', null],
    ['negative', -500],
    ['NaN', NaN],
    ['non-numeric string', 'abc'],
  ])('rejects present-but-invalid earnest_money (%s) by throwing — no fabricated default', (_label, value) => {
    expect(() => generatePurchaseAgreement(baseVars({ earnest_money: value as any }))).toThrow(
      /earnest_money must be a number or absent|earnest_money must be a non-negative number when provided/,
    );
  });
});

describe('earnest_money — TX addendum never fabricates a deposit', () => {
  function texasVars(overrides: Record<string, unknown> = {}) {
    return {
      property_address: '100 Main St, Austin, TX 78701',
      contract_date: '2026-10-15',
      seller_name: 'Jane Seller',
      buyer_name: 'DealSwift Automation LLC and/or Assigns',
      ...overrides,
    };
  }

  it('renders the recorded earnest money when present', () => {
    const content = generateTexasAddendum(texasVars({ earnest_money: 2500 }) as any);
    expect(content).toContain('EARNEST MONEY: $2,500.00');
  });

  it.each([
    ['absent (undefined)', undefined],
    ['zero (0 is "no deposit", not $0)', 0],
    ['NaN', NaN],
  ])('does NOT inject $1,000 when earnest_money is %s — renders "To Be Negotiated"', (_label, value) => {
    const overrides =
      value === undefined ? {} : { earnest_money: value as any };
    const content = generateTexasAddendum(texasVars(overrides) as any);
    // The fabricated $1,000 must NEVER appear on the legal addendum.
    expect(content).not.toContain('$1,000.00');
    expect(content).not.toContain('$1000');
    expect(content).toContain('EARNEST MONEY: To Be Negotiated (not yet recorded)');
  });
});
