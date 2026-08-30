/**
 * evalHarness — the offline replay loop.
 *
 * Three properties are load-bearing:
 *  1. Disqualified candidates are NEVER judged (that is the cost discipline).
 *  2. The judge is BLIND — no variant id reaches it, or it could prefer
 *     "v2-improved" on the name alone and the sweep would be worthless.
 *  3. One bad model call degrades a variant's compliance rate; it does not
 *     throw away the other 199 results.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { callAnthropic } = vi.hoisted(() => ({ callAnthropic: vi.fn() }));
vi.mock('@/app/api/utils/anthropic-client', () => ({ callAnthropic }));

import { runSweep, parseJudgeScore, judgeCandidate, type PromptVariant, type EvalTranscript } from '../evalHarness';

const CLEAN = 'Are you open to a cash offer on the property? Reply STOP to opt out.';
const LEAKY = 'We can pay $120,000 today. Reply STOP to opt out.';
const GOOD_JUDGE = '{"relevance":0.9,"advancesConversation":0.8,"likelyToGetReply":0.7}';

const variants: PromptVariant[] = [
  { id: 'v1-baseline', system: 'You are an acquisition assistant.' },
  { id: 'v2-improved', system: 'You are a warmer acquisition assistant.' },
];
const transcripts: EvalTranscript[] = [
  { id: 't1', history: [{ role: 'user', content: 'who is this?' }] },
  { id: 't2', history: [{ role: 'user', content: 'not interested' }] },
];

beforeEach(() => {
  vi.clearAllMocks();
});

/** Generation and judging both go through callAnthropic; route by system prompt. */
function wire(opts: { generate: (system: string) => string; judge?: string }) {
  callAnthropic.mockImplementation(async (o: any) => {
    if (typeof o.system === 'string' && o.system.startsWith('You score')) {
      return { text: opts.judge ?? GOOD_JUDGE };
    }
    return { text: opts.generate(o.system) };
  });
}

describe('parseJudgeScore', () => {
  it('parses a clean payload', () => {
    expect(parseJudgeScore(GOOD_JUDGE)).toEqual({
      relevance: 0.9,
      advancesConversation: 0.8,
      likelyToGetReply: 0.7,
    });
  });

  it('tolerates fences and surrounding prose', () => {
    expect(parseJudgeScore('Sure!\n```json\n' + GOOD_JUDGE + '\n```')).not.toBeNull();
  });

  it('returns null rather than NaN on malformed or out-of-range input', () => {
    for (const bad of ['', 'not json', '{"relevance":2,"advancesConversation":1,"likelyToGetReply":1}', '{"relevance":0.5}']) {
      expect(parseJudgeScore(bad), bad).toBeNull();
    }
  });
});

describe('cost discipline — disqualified candidates are never judged', () => {
  it('judges only compliant candidates', async () => {
    // v1 always leaks a price; v2 is clean. 4 candidates, only 2 judgeable.
    wire({ generate: (system) => (system.includes('warmer') ? CLEAN : LEAKY) });

    const r = await runSweep(variants, transcripts, { isFirstTouch: true, channel: 'sms' });
    expect(r.candidates).toBe(4);
    expect(r.skippedAsDisqualified).toBe(2);
    expect(r.judged).toBe(2);
    expect(r.judgeCallsSaved).toBe(2);

    const judgeCalls = callAnthropic.mock.calls.filter((c: any) => c[0].system?.startsWith('You score'));
    expect(judgeCalls).toHaveLength(2);
  });

  it('makes ZERO judge calls when every candidate is disqualified', async () => {
    wire({ generate: () => LEAKY });
    const r = await runSweep(variants, transcripts, { isFirstTouch: true, channel: 'sms' });
    expect(r.judged).toBe(0);
    expect(callAnthropic.mock.calls.filter((c: any) => c[0].system?.startsWith('You score'))).toHaveLength(0);
  });

  it('hardOnly skips the paid judge entirely', async () => {
    wire({ generate: () => CLEAN });
    const r = await runSweep(variants, transcripts, { hardOnly: true, isFirstTouch: true, channel: 'sms' });
    expect(r.judged).toBe(0);
    expect(r.candidates).toBe(4);
    expect(callAnthropic.mock.calls.filter((c: any) => c[0].system?.startsWith('You score'))).toHaveLength(0);
  });

  it('honours maxJudgeCalls as a spend ceiling', async () => {
    wire({ generate: () => CLEAN });
    const r = await runSweep(variants, transcripts, {
      maxJudgeCalls: 1,
      isFirstTouch: true,
      channel: 'sms',
    });
    expect(r.judged).toBe(1);
  });
});

describe('the judge is blind', () => {
  it('never receives a variant id or transcript id', async () => {
    wire({ generate: () => CLEAN });
    await runSweep(variants, transcripts, { isFirstTouch: true, channel: 'sms' });

    const judgeCalls = callAnthropic.mock.calls.filter((c: any) => c[0].system?.startsWith('You score'));
    expect(judgeCalls.length).toBeGreaterThan(0);
    for (const [arg] of judgeCalls) {
      const payload = JSON.stringify(arg);
      expect(payload).not.toContain('v1-baseline');
      expect(payload).not.toContain('v2-improved');
      expect(payload).not.toContain('t1');
    }
  });
});

describe('resilience', () => {
  it('a generation failure degrades that variant, it does not abort the sweep', async () => {
    let n = 0;
    callAnthropic.mockImplementation(async (o: any) => {
      if (o.system?.startsWith('You score')) return { text: GOOD_JUDGE };
      n++;
      if (n === 1) throw new Error('model 529');
      return { text: CLEAN };
    });

    const r = await runSweep(variants, transcripts, { isFirstTouch: true, channel: 'sms' });
    expect(r.candidates).toBe(4); // nothing lost
    expect(r.skippedAsDisqualified).toBe(1); // the empty one only
    expect(r.judged).toBe(3);
  });

  it('a malformed judge response leaves the candidate unjudged, not crashed', async () => {
    wire({ generate: () => CLEAN, judge: 'I cannot comply.' });
    const r = await runSweep(variants, transcripts, { isFirstTouch: true, channel: 'sms' });
    expect(r.judged).toBe(0);
    expect(r.winner).toBeNull(); // nothing scored => no winner claimed
  });

  it('returns an empty report for empty inputs without calling the model', async () => {
    const r = await runSweep([], transcripts);
    expect(r).toMatchObject({ candidates: 0, judged: 0, winner: null });
    expect(callAnthropic).not.toHaveBeenCalled();
  });
});

describe('winner selection', () => {
  it('picks the compliant variant, not the higher-scoring leaky one', async () => {
    // v1 leaks but would score well; v2 is clean. Compliance must win.
    wire({ generate: (system) => (system.includes('warmer') ? CLEAN : LEAKY) });
    const r = await runSweep(variants, transcripts, { isFirstTouch: true, channel: 'sms' });
    expect(r.winner).toBe('v2-improved');

    const v1 = r.summaries.find((s) => s.variantId === 'v1-baseline')!;
    expect(v1.complianceRate).toBe(0);
    expect(v1.meanQuality).toBeNull();
    expect(v1.violationsByRule['escalation-invariant']).toBe(2);
  });

  it('reports per-variant compliance so a failure says WHY', async () => {
    wire({ generate: () => LEAKY });
    const r = await runSweep(variants, transcripts, { isFirstTouch: true, channel: 'sms' });
    for (const s of r.summaries) {
      expect(s.complianceRate).toBe(0);
      expect(s.violationsByRule['escalation-invariant']).toBeGreaterThan(0);
    }
    expect(r.winner).toBeNull();
  });
});
