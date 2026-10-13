/**
 * Tests for the plain-language contract summary.
 *
 * The most important cases are the ANTI-FABRICATION ones: the summary must never
 * invent a price, a closing date, or a profit claim that is not in the contract
 * fields. A wholesaler must never be shown an invented "$X average" figure (that
 * is the same defect class fixed in the funnel avg-deal-value work).
 */
import { describe, it, expect } from 'vitest';
import {
  buildPlainContractSummary,
  formatWholeDollars,
  formatFriendlyDate,
  isAwaitingSignature,
} from '../plainContractSummary';

describe('formatWholeDollars', () => {
  it('formats cents as whole dollars', () => {
    expect(formatWholeDollars(2500000)).toBe('$25,000');
    expect(formatWholeDollars(32000000)).toBe('$320,000');
    expect(formatWholeDollars(0)).toBe('$0');
  });

  it('rounds to whole dollars (no cents leak)', () => {
    expect(formatWholeDollars(254999)).toBe('$2,550'); // 2549.99 -> 2550
    // 99 cents rounds up to $1; 49 cents rounds down to $0. Either way, no cents show.
    expect(formatWholeDollars(99)).toBe('$1');
    expect(formatWholeDollars(49)).toBe('$0');
  });

  it('returns null for nullish / non-finite', () => {
    expect(formatWholeDollars(null)).toBeNull();
    expect(formatWholeDollars(undefined)).toBeNull();
    expect(formatWholeDollars(Number.NaN)).toBeNull();
  });
});

describe('formatFriendlyDate', () => {
  it('formats a valid ISO date', () => {
    expect(formatFriendlyDate('2026-03-04')).toBe('March 4, 2026');
  });

  it('does not shift days for date-only input in non-UTC timezones', () => {
    // Regression guard: new Date('2026-03-04') treats the string as UTC and
    // renders the previous day in UTC-West zones. The helper must preserve
    // the calendar date the user supplied.
    expect(formatFriendlyDate('2026-01-01')).toBe('January 1, 2026');
    expect(formatFriendlyDate('2026-12-31')).toBe('December 31, 2026');
  });

  it('returns null for nullish or invalid', () => {
    expect(formatFriendlyDate(null)).toBeNull();
    expect(formatFriendlyDate(undefined)).toBeNull();
    expect(formatFriendlyDate('not-a-date')).toBeNull();
  });
});

describe('isAwaitingSignature', () => {
  it('true for pending/draft/sent/empty', () => {
    expect(isAwaitingSignature({ status: 'PENDING_SIGNATURE' })).toBe(true);
    expect(isAwaitingSignature({ esignStatus: 'pending' })).toBe(true);
    expect(isAwaitingSignature({ esignStatus: 'draft' })).toBe(true);
    expect(isAwaitingSignature({ esignStatus: 'sent' })).toBe(true);
    expect(isAwaitingSignature({})).toBe(true);
  });

  it('false once signed', () => {
    expect(isAwaitingSignature({ status: 'SIGNED' })).toBe(false);
    expect(isAwaitingSignature({ esignStatus: 'signed' })).toBe(false);
  });
});

describe('buildPlainContractSummary — seller side', () => {
  const input = {
    direction: 'SELLER',
    status: 'PENDING_SIGNATURE',
    esignStatus: 'sent',
    contractPriceCents: 32000000,
    assignmentFeeCents: 500000,
    closingDate: '2026-03-04',
    propertyAddress: '123 Main St',
  };

  it('headline includes the real price and address', () => {
    const s = buildPlainContractSummary(input);
    expect(s.headline).toBe('$320,000 deal on the property at 123 Main St');
  });

  it('what explains the deal in plain words and cites the real price', () => {
    const s = buildPlainContractSummary(input);
    expect(s.what).toContain('sell');
    expect(s.what).toContain('$320,000');
    expect(s.what).toContain('March 4, 2026');
  });

  it('needsSignature is true while awaiting signature', () => {
    expect(buildPlainContractSummary(input).needsSignature).toBe(true);
  });

  it('next step is to sign while unsigned', () => {
    const s = buildPlainContractSummary(input);
    expect(s.nextSteps.join(' ')).toMatch(/sign the contract/i);
  });

  it('mentions the recorded assignment fee', () => {
    const s = buildPlainContractSummary(input);
    expect(s.whyGoodForYou.join(' ')).toContain('$5,000');
  });
});

describe('buildPlainContractSummary — buyer side', () => {
  it('frames the deal from the buyer POV', () => {
    const s = buildPlainContractSummary({
      direction: 'BUYER',
      status: 'SIGNED',
      contractPriceCents: 18000000,
      closingDate: '2026-05-01',
      propertyAddress: '9 Oak Ave',
    });
    expect(s.headline).toContain('$180,000');
    expect(s.what).toContain('buy');
    expect(s.needsSignature).toBe(false);
    expect(s.nextSteps.join(' ')).toMatch(/signed/i);
  });
});

describe('buildPlainContractSummary — ANTI-FABRICATION', () => {
  it('never invents a price when contract_price_cents is missing', () => {
    const s = buildPlainContractSummary({
      direction: 'SELLER',
      status: 'DRAFT',
      propertyAddress: '1 Nowhere Rd',
    });
    expect(s.headline).toBe('Deal on the property at 1 Nowhere Rd');
    expect(s.what).toMatch(/price has not been set/i);
    // No dollar figure anywhere in the output.
    expect(JSON.stringify(s)).not.toMatch(/\$/);
  });

  it('never invents a closing date when one is missing', () => {
    const s = buildPlainContractSummary({
      direction: 'SELLER',
      contractPriceCents: 10000000,
    });
    expect(s.what).toMatch(/closing date has not been scheduled/i);
    expect(s.nextSteps.join(' ')).toMatch(/agree on a closing date/i);
  });

  it('never claims an assignment fee when none is recorded', () => {
    const s = buildPlainContractSummary({
      direction: 'SELLER',
      contractPriceCents: 10000000,
      // no assignmentFeeCents
    });
    expect(s.whyGoodForYou.join(' ')).not.toMatch(/assignment fee/i);
  });

  it('falls back to a generic subject when no address is present (no "undefined")', () => {
    const s = buildPlainContractSummary({ direction: 'SELLER', contractPriceCents: 5000000 });
    expect(s.headline).toContain('this property');
    expect(JSON.stringify(s)).not.toMatch(/undefined|null|NaN/);
  });
});
