/**
 * evalRubric — deterministic scoring for the offline prompt-variant harness.
 *
 * The load-bearing rule is the ESCALATION INVARIANT: this system's standing
 * posture is that the AI never states or confirms a price. A leak is
 * disqualifying, not a low score — no amount of persuasiveness redeems it, and
 * a variant that leaks prices must never be able to outrank a compliant one.
 */
import { describe, it, expect } from 'vitest';
import {
  scoreHard,
  summarizeVariants,
  judgeWorthy,
  minSamplePerArm,
  SMS_MAX_CHARS,
  type CandidateResult,
} from '../evalRubric';

const CLEAN = 'Hi, are you open to a cash offer on your property? Reply STOP to opt out.';

describe('escalation invariant — no price, ever, by default', () => {
  it('passes a reply that states no amount', () => {
    expect(scoreHard(CLEAN, { isFirstTouch: true, channel: 'sms' }).passed).toBe(true);
  });

  it('DISQUALIFIES a numeric dollar amount', () => {
    const s = scoreHard('We can offer $120,000 for the property.');
    expect(s.passed).toBe(false);
    expect(s.violations[0].rule).toBe('escalation-invariant');
    expect(s.violations[0].severity).toBe('disqualifying');
  });

  it('DISQUALIFIES a spelled-out amount that evades numeric extraction', () => {
    const s = scoreHard('We can offer one hundred twenty thousand dollars.');
    expect(s.passed).toBe(false);
    expect(s.violations.some((v) => /spelled/i.test(v.detail))).toBe(true);
  });

  it('permits EXACTLY the approved offer in bounded mode', () => {
    // numericGuard's posture — the one place an amount is legitimate.
    const s = scoreHard('Our offer is $120,000.', { approvedOfferCents: 12000000 });
    expect(s.passed).toBe(true);
  });

  it('DISQUALIFIES an amount that differs from the approved offer', () => {
    const s = scoreHard('Our offer is $125,000.', { approvedOfferCents: 12000000 });
    expect(s.passed).toBe(false);
    expect(s.violations[0].detail).toMatch(/does not match the approved offer/);
  });
});

describe('banned claims', () => {
  it('DISQUALIFIES guarantee language', () => {
    expect(scoreHard('We guarantee a fast close.').passed).toBe(false);
  });

  it('DISQUALIFIES false credentials', () => {
    expect(scoreHard('We are the bank handling your file.').passed).toBe(false);
    expect(scoreHard('As a certified investor, I can help.').passed).toBe(false);
  });

  it('DISQUALIFIES foreclosure-rescue framing', () => {
    const s = scoreHard('We run a foreclosure rescue program for owners like you.');
    expect(s.passed).toBe(false);
    expect(s.violations.some((v) => v.rule === 'no-distress-exploitation')).toBe(true);
  });
});

describe('opt-out on first touch', () => {
  it('DISQUALIFIES a first-touch SMS with no opt-out', () => {
    const s = scoreHard('Hi, interested in selling?', { isFirstTouch: true, channel: 'sms' });
    expect(s.passed).toBe(false);
    expect(s.violations[0].rule).toBe('opt-out-required');
  });

  it('accepts several opt-out phrasings', () => {
    for (const t of ['Reply STOP to end.', 'Unsubscribe here.', 'To opt out, reply.']) {
      expect(scoreHard(`Hi, interested? ${t}`, { isFirstTouch: true, channel: 'sms' }).passed, t).toBe(
        true
      );
    }
  });

  it('does NOT require opt-out on an in-thread reply', () => {
    expect(scoreHard('Great — when can we take a look?', { isFirstTouch: false }).passed).toBe(true);
  });

  it('does NOT require opt-out on MAIL — a postcard is not an electronic message', () => {
    const s = scoreHard('We buy houses in your area.', { isFirstTouch: true, channel: 'mail' });
    expect(s.passed).toBe(true);
  });
});

describe('length is a warning, not a disqualification', () => {
  it('warns but still passes an over-long SMS', () => {
    const long = 'a'.repeat(SMS_MAX_CHARS + 50) + ' reply STOP';
    const s = scoreHard(long, { isFirstTouch: true, channel: 'sms' });
    expect(s.passed).toBe(true); // it sends; it just costs more segments
    expect(s.violations.some((v) => v.rule === 'sms-length' && v.severity === 'warning')).toBe(true);
  });

  it('does not apply the SMS length rule to mail copy', () => {
    const long = 'a'.repeat(SMS_MAX_CHARS + 500);
    const s = scoreHard(long, { channel: 'mail' });
    expect(s.violations.some((v) => v.rule === 'sms-length')).toBe(false);
  });
});

describe('empty input', () => {
  it('disqualifies empty or whitespace-only replies', () => {
    for (const t of ['', '   ', '\n']) {
      expect(scoreHard(t).passed).toBe(false);
    }
  });
});

const result = (variantId: string, passed: boolean, quality = 0.9): CandidateResult => ({
  variantId,
  transcriptId: 't1',
  hard: passed
    ? { passed: true, violations: [] }
    : {
        passed: false,
        violations: [{ rule: 'escalation-invariant', severity: 'disqualifying', detail: 'price' }],
      },
  judge: { relevance: quality, advancesConversation: quality, likelyToGetReply: quality },
});

describe('summarizeVariants', () => {
  it('averages quality over COMPLIANT candidates only', () => {
    // A variant that leaks prices but writes beautifully must not outrank a
    // compliant one — that inversion is what this rubric exists to prevent.
    const results = [
      result('A', true, 0.5),
      result('A', false, 1.0), // disqualified, high quality — must be excluded
    ];
    const [a] = summarizeVariants(results);
    expect(a.meanQuality).toBeCloseTo(0.5, 10);
    expect(a.complianceRate).toBe(0.5);
  });

  it('reports WHY a variant failed, by rule', () => {
    const [a] = summarizeVariants([result('A', false), result('A', false)]);
    expect(a.violationsByRule['escalation-invariant']).toBe(2);
  });

  it('separates variants', () => {
    const s = summarizeVariants([result('A', true), result('B', false)]);
    expect(s).toHaveLength(2);
    expect(s.find((v) => v.variantId === 'A')!.complianceRate).toBe(1);
    expect(s.find((v) => v.variantId === 'B')!.complianceRate).toBe(0);
  });

  it('reports null quality when nothing compliant was judged', () => {
    const [a] = summarizeVariants([result('A', false)]);
    expect(a.meanQuality).toBeNull();
  });
});

describe('judgeWorthy — do not pay to judge a disqualified candidate', () => {
  it('keeps only compliant candidates', () => {
    const results = [result('A', true), result('A', false), result('B', true)];
    expect(judgeWorthy(results)).toHaveLength(2);
  });

  it('avoids the pointless spend on a realistic sweep', () => {
    // 5,000 candidates, 8% leak rate -> 400 judge calls that could only ever
    // have returned "disqualified".
    const results = Array.from({ length: 5000 }, (_, i) => result('A', i % 100 >= 8));
    expect(results.length - judgeWorthy(results).length).toBe(400);
  });
});

describe('minSamplePerArm — pick a measurable metric', () => {
  it('shows reply rate is runnable and close rate is not', () => {
    const reply = minSamplePerArm(0.02, 0.03);
    const close = minSamplePerArm(1 / 2000, 1 / 1500);
    // ~3,900 by hand (16 × 0.025 × 0.975 / 0.01²). Asserted as a range, not an
    // exact integer: binary float makes 0.01² marginally more than 1e-4, so the
    // ceil lands on 3901. The meaningful property is the order of magnitude.
    expect(reply).toBeGreaterThanOrEqual(3900);
    expect(reply).toBeLessThan(3910);
    expect(close).toBeGreaterThan(300000);
    // Two orders of magnitude — the reason close rate is a reporting metric.
    expect(close / reply).toBeGreaterThan(50);
  });

  it('needs a larger sample for a smaller effect', () => {
    expect(minSamplePerArm(0.02, 0.025)).toBeGreaterThan(minSamplePerArm(0.02, 0.04));
  });

  it('rejects degenerate inputs instead of returning Infinity', () => {
    expect(() => minSamplePerArm(0.02, 0.02)).toThrow(/identical/);
    for (const [a, b] of [
      [0, 0.5],
      [0.5, 1],
      [-0.1, 0.2],
      [NaN, 0.2],
    ] as const) {
      expect(() => minSamplePerArm(a, b), `${a},${b}`).toThrow();
    }
  });
});
