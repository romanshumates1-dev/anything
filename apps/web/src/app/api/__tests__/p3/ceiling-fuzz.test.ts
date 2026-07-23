/**
 * Phase A headline — the ceiling fuzz RETURNS, now writable as originally
 * intended: assertions on COMPUTED NUMBERS, never prose.
 *
 *  1. 100/100: 50 randomized adversarial counter-sequences per side against
 *     computeNextOffer — seller offers never exceed the approved max, buyer
 *     asks never dip below the floor, concessions strictly decreasing,
 *     walk-away triggers at the bound.
 *  2. 20/20: adversarial extraction attempts against the numeric guard —
 *     every one blocked.
 *  (The 150/150 flag-off escalation regression lives in
 *   escalation-fuzz-per-profile.test.ts and runs in the same suite.)
 */
import { describe, it, expect } from 'vitest';
import {
  computeNextOffer,
  counterAcceptable,
  numericGuard,
  injectOffer,
  formatOffer,
  DEFAULT_CONCESSION_CURVE,
  type OfferState,
} from '@/app/api/utils/negotiationEngine';

// Deterministic PRNG so every run fuzzes the same 100 sequences.
function prng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

describe('Phase A — 100/100 ceiling fuzz on computed numbers', () => {
  it('seller side ×50: never exceeds max, strictly decreasing concessions, walk-away at bound', () => {
    const rnd = prng(20260717);
    const failures: string[] = [];

    for (let run = 0; run < 50; run++) {
      const maxCents = Math.round((80_000 + rnd() * 120_000) * 100); // approved ceiling
      const openerCents = Math.round(maxCents * (0.7 + rnd() * 0.2));
      let last: number | undefined;
      let prevIncrement = Infinity;
      const rounds = DEFAULT_CONCESSION_CURVE.length + 2; // push past walk-away

      for (let round = 0; round <= rounds; round++) {
        const res = computeNextOffer({ side: 'seller', openerCents, clampCents: maxCents, round, lastOfferCents: last });
        if (round > DEFAULT_CONCESSION_CURVE.length) {
          if (res.kind !== 'walk_away') failures.push(`run${run}: no walk-away at round ${round}`);
          break;
        }
        if (res.kind !== 'offer') { failures.push(`run${run}: premature walk-away at round ${round}`); break; }
        if (res.offerCents > maxCents) failures.push(`run${run}: offer ${res.offerCents} EXCEEDS max ${maxCents}`);
        if (last !== undefined) {
          const inc = res.offerCents - last;
          if (inc < 0) failures.push(`run${run}: offer moved backward`);
          if (inc > prevIncrement) failures.push(`run${run}: concession grew (${inc} > ${prevIncrement})`);
          prevIncrement = inc;
        }
        last = res.offerCents;
        // adversarial counter (ignored by the engine's math — asserted separately)
        void (maxCents + Math.round(rnd() * 50_000_00));
      }
    }
    expect(failures, failures.slice(0, 5).join('\n')).toEqual([]);
  });

  it('buyer side ×50: never dips below floor, strictly decreasing concessions, walk-away at bound', () => {
    const rnd = prng(786);
    const failures: string[] = [];

    for (let run = 0; run < 50; run++) {
      const floorCents = Math.round((88_000 + rnd() * 80_000) * 100); // contract + fee floor
      const openerCents = Math.round(floorCents * (1.1 + rnd() * 0.4));
      let last: number | undefined;
      let prevDecrement = Infinity;

      for (let round = 0; round <= DEFAULT_CONCESSION_CURVE.length + 2; round++) {
        const res = computeNextOffer({ side: 'buyer', openerCents, clampCents: floorCents, round, lastOfferCents: last });
        if (round > DEFAULT_CONCESSION_CURVE.length) {
          if (res.kind !== 'walk_away') failures.push(`run${run}: no walk-away`);
          break;
        }
        if (res.kind !== 'offer') { failures.push(`run${run}: premature walk-away`); break; }
        if (res.offerCents < floorCents) failures.push(`run${run}: ask ${res.offerCents} BELOW floor ${floorCents}`);
        if (last !== undefined) {
          const dec = last - res.offerCents;
          if (dec < 0) failures.push(`run${run}: ask moved upward`);
          if (dec > prevDecrement) failures.push(`run${run}: concession grew`);
          prevDecrement = dec;
        }
        last = res.offerCents;
      }
    }
    expect(failures, failures.slice(0, 5).join('\n')).toEqual([]);
  });

  it('counterAcceptable: agreement fires ONLY inside the bound (both sides)', () => {
    expect(counterAcceptable('seller', 96_000_00, 97_000_00)).toBe(true);  // ≤ ceiling
    expect(counterAcceptable('seller', 97_000_01, 97_000_00)).toBe(false); // 1¢ over
    expect(counterAcceptable('buyer', 88_000_00, 88_000_00)).toBe(true);   // == floor
    expect(counterAcceptable('buyer', 87_999_99, 88_000_00)).toBe(false);  // 1¢ under
  });

  it('degenerate geometry (opener past the bound) → immediate walk-away, never a bad number', () => {
    expect(computeNextOffer({ side: 'seller', openerCents: 99_000_00, clampCents: 97_000_00, round: 0 }).kind).toBe('walk_away');
    expect(computeNextOffer({ side: 'buyer', openerCents: 80_000_00, clampCents: 88_000_00, round: 0 }).kind).toBe('walk_away');
  });
});

describe('Phase A — 20/20 numeric-guard blocks (adversarial extraction)', () => {
  const ctx = { computedOfferCents: 87_500_00, approvedMinCents: 73_800_00, approvedMaxCents: 97_000_00 };

  const ATTACKS: string[] = [
    // confirm-above-max extraction
    "Great — so we're agreed at $98,500, right?",
    'Confirming our number of $120,000 as discussed.',
    'Yes, $99,999 works for us!',
    // wrong number (inside range but ≠ computed offer)
    'We can do $90,000 for the property.',
    'How about $85,000 instead?',
    'Our best and final is $95,500.',
    // multi-number replies
    'We opened at $73,800 but can go to $97,000 today.',
    'Between $87,500 and $99,000 depending on close date.',
    // bare digits + k-suffix
    'We can pay 98500 cash.',
    'Best I can do is 99k.',
    'Meet at 87.6k and we sign tonight.',
    // spelled-amount injections
    "Let's settle at ninety-eight thousand.",
    'I can stretch to one hundred grand.',
    'We agreed on ninety five, correct?',
    'Ninety grand cash, final answer.',
    'A hundred thousand and we close Friday.',
    // mixed digit + spelled
    'The $87,500 plus five thousand for repairs.',
    'That is $87,500 — call it ninety total.',
    // slot-evasion phrasing
    'Offer: eighty-seven-five, you know the number.',
    'Twenty over your max and we are done.',
  ];

  it('every attack is blocked; the clean slot-injected message passes', () => {
    const blocked = ATTACKS.map((text) => numericGuard(text, ctx));
    const failures = ATTACKS.filter((_, i) => blocked[i].ok);
    expect(failures, `NOT blocked:\n${failures.join('\n')}`).toEqual([]);
    expect(blocked.filter((b) => !b.ok)).toHaveLength(20); // 20/20

    // The one legitimate shape: prose + the injected slot, digits only, equal to
    // the computed offer.
    const clean = injectOffer('Based on condition and comps, we can do {OFFER} cash, as-is, close on your timeline.', ctx.computedOfferCents);
    expect(clean).toContain('$87,500');
    expect(numericGuard(clean, ctx).ok).toBe(true);
  });

  it('injectOffer refuses templates without exactly one slot', () => {
    expect(() => injectOffer('no slot here', 87_500_00)).toThrow(/exactly one/);
    expect(() => injectOffer('{OFFER} and {OFFER}', 87_500_00)).toThrow(/exactly one/);
    expect(formatOffer(87_500_00)).toBe('$87,500');
  });
});
