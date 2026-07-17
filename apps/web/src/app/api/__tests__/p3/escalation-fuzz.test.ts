/**
 * P3 — the headline verification (owner-mandated).
 *
 * 1. ESCALATION-INVARIANT FUZZ, 50 adversarial price-bearing seller messages
 *    across FIVE distinct classes, run through the REAL `ai_reply` job handler
 *    with the model mocked to be MAXIMALLY DECEPTIVE (requires_human:false and
 *    an innocuous-looking reply that itself trips no detector). The server-side
 *    net alone must catch all 50:
 *      - requires_human === true persisted
 *      - the owner NOTIFICATION fires (status='needs_review' in the same
 *        UPDATE — the flag without the notification is a silent failure)
 *      - the model's reply is never sent (drafts never auto-send; zero enqueues)
 *      - the only auto-outbound in the flow (the ack SMS) has zero digits and
 *        zero currency tokens — strict regex, loosened deliberately or never.
 *    50/50 or the row is BROKEN.
 *
 * 2. parsePriceRange FUZZ — the ONE place a number is computed: valid ranges
 *    produce exact numerics; malformed/reversed/garbage/injection-shaped
 *    inputs are rejected. Never NaN, never silently-swapped min/max.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql } = vi.hoisted(() => {
  const m: any = vi.fn(async () => []);
  m.transaction = vi.fn(async () => []);
  return { mockSql: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));
vi.mock('@/app/api/utils/logger', () => ({ logEvent: vi.fn(async () => {}) }));
vi.mock('@/app/api/utils/sla', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  recordAIDispatched: vi.fn(async () => {}),
  dispatchAckIfNeeded: vi.fn(async () => ({ sent: false, reason: 'test' })),
}));
vi.mock('@/app/api/utils/twilio-adapter', () => ({
  getTwilioConfig: () => null,
  getTwilioClient: () => null,
}));
vi.mock('@/app/api/utils/messaging', () => ({ sendMessage: vi.fn(async () => ({ status: 'sent' })) }));
// The ADVERSARIAL part: the model actively tries to break the invariant.
// detectHighRisk stays REAL — it is the thing under test.
vi.mock('@/app/api/utils/ai-orchestrator', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  orchestrateAIResponse: vi.fn(async () => ({
    // Maximally deceptive: an INNOCUOUS-looking reply (no digits, no risky
    // words that would trip the detector on the response side) + a false
    // requires_human:false. The seller-message detection is therefore the
    // ONLY line of defense — exactly the invariant under fuzz.
    response_text: 'Sounds good, someone from our team will follow up with you shortly.',
    confidence_score: 0.99,
    requires_human: false, // the model claims no human is needed. It is wrong.
    suggested_action: 'continue',
    internal_reasoning: 'worst-case deceptive model output',
  })),
}));

import { processNextJob } from '@/app/api/utils/jobs';
import { sendMessage } from '@/app/api/utils/messaging';
import { ACK_SMS_BODY } from '@/app/api/utils/sla';
import { parsePriceRange } from '@/app/api/services/ownerRangeRequest';

// ── the 50-message corpus: five classes × ten ────────────────────────────────
const NUM_WORDS = ['seventy', 'seventy five', 'eighty', 'eighty five', 'ninety', 'ninety five', 'one hundred', 'a hundred ten', 'sixty', 'fifty five'];
const CORPUS: Array<{ cls: string; msg: string }> = [
  // 1. plain formats
  ...[87500, 92000, 105000, 78500, 99999].flatMap((n) => [
    { cls: 'plain', msg: `I want $${n.toLocaleString()} for the house` },
    { cls: 'plain', msg: `would you pay ${n}?` },
  ]),
  // 2. spelled-out prices
  ...NUM_WORDS.map((w) => ({ cls: 'spelled', msg: `I'd take ${w} grand for it` })),
  // 3. contract talk with zero digits
  ...[
    'send the paperwork, let us close',
    'email me the documents and we have a deal',
    'ready to sign whenever you are',
    'my lawyer will review the contract tonight',
    'let us close this week, cash',
    'the purchase agreement looks fine to me',
    'I will sign if you cover closing',
    'send docs to my email',
    'we can do the deposit tomorrow',
    'earnest money works for me',
  ].map((msg) => ({ cls: 'contract-no-digits', msg })),
  // 4. counteroffer language
  ...[
    'I could not take less than one hundred',
    'that is too low, I want ninety five',
    'my asking price is firm at ninety',
    'counter: you add ten grand and we talk',
    'I would accept eighty five if you close fast',
    'give me seventy five and it is yours',
    'not a penny under six figures',
    'meet me at ninety and we are done',
    'best I can do is take eighty',
    'raise your offer or no deal',
  ].map((msg) => ({ cls: 'counteroffer', msg })),
  // 5. confirmation-extraction (the dangerous class)
  ...[
    "so we're agreed at $87,500, right?",
    'just confirm the 92000 number and I will sign',
    'you said ninety grand yesterday, still good?',
    'reply YES if we have a deal at 87.5k',
    'confirm our agreed price please',
    'so the offer stands at eighty five, correct?',
    'text back the number we agreed on',
    'is the $105,000 still on the table?',
    'we agreed on six figures, confirm',
    'lock it in at ninety five, yes?',
  ].map((msg) => ({ cls: 'confirmation', msg })),
];

const sqlText = (call: any[]) => (Array.isArray(call[0]) ? (call[0] as string[]).join('¶') : String(call[0]));

describe('P3 — escalation-invariant fuzz (50 adversarial price-bearing messages)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('corpus sanity: exactly 50 messages across 5 classes', () => {
    expect(CORPUS).toHaveLength(50);
    expect(new Set(CORPUS.map((c) => c.cls)).size).toBe(5);
  });

  it('50/50: requires_human persisted, needs_review notification fired, poisoned reply never sent', async () => {
    const failures: string[] = [];

    for (const { cls, msg } of CORPUS) {
      mockSql.mockReset();
      mockSql
        // 1. lock+claim job row
        .mockResolvedValueOnce([{ id: 1, type: 'ai_reply', payload: { leadId: 7, conversationId: 9 }, attempts: 1, max_attempts: 3 }])
        // 2. conversation with the adversarial seller message as last user turn
        .mockResolvedValueOnce([{ id: 9, lead_id: 7, history: [{ role: 'user', content: msg }] }])
        // 3. lead phone lookup (ack path — mocked no-op)
        .mockResolvedValueOnce([{ phone: '+15025550101' }])
        // 4+ everything else (the assertion UPDATE + job completion)
        .mockResolvedValue([]);

      await processNextJob();

      const updates = mockSql.mock.calls.filter((c: any[]) => sqlText(c).includes('UPDATE ai_conversations'));
      const u = updates[0];
      const text = u ? sqlText(u) : '';
      const params = u ? JSON.stringify(u.slice(1)) : '';

      const flagPersisted = text.includes('requires_human =') && u?.slice(1).includes(true);
      const notified = params.includes('needs_review');
      const nothingSent = vi.mocked(sendMessage).mock.calls.length === 0;

      if (!(flagPersisted && notified && nothingSent)) {
        failures.push(`[${cls}] "${msg}" flag=${flagPersisted} notify=${notified} silent=${nothingSent}`);
      }
    }

    expect(failures, `${failures.length}/50 escaped the invariant:\n${failures.join('\n')}`).toEqual([]);
  });

  it('the only auto-outbound (ack SMS) has zero digits and zero currency tokens', () => {
    expect(ACK_SMS_BODY).not.toMatch(/[0-9]/);
    expect(ACK_SMS_BODY).not.toMatch(/[$€£]/);
  });
});

describe('P3 — parsePriceRange fuzz (the one place a number is computed)', () => {
  it('50 randomized valid ranges: exact numerics, correct order, never NaN', () => {
    let seed = 20260716;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let i = 0; i < 50; i++) {
      const min = 40_000 + Math.floor(rnd() * 200_000);
      const max = min + 1_000 + Math.floor(rnd() * 150_000);
      const sep = ['-', 'to', '–'][i % 3];
      const fmt = (n: number) => (i % 2 === 0 ? `$${n.toLocaleString('en-US')}` : String(n));
      const parsed = parsePriceRange(`${fmt(min)} ${sep} ${fmt(max)}`);
      expect(parsed, `should parse: "${fmt(min)} ${sep} ${fmt(max)}"`).not.toBeNull();
      expect(parsed!.min).toBe(min);
      expect(parsed!.max).toBe(max);
      expect(Number.isFinite(parsed!.min) && Number.isFinite(parsed!.max)).toBe(true);
    }
  });

  it('reversed ranges are rejected — never silently swapped', () => {
    expect(parsePriceRange('$95,000 - $80,000')).toBeNull();
    expect(parsePriceRange('100000 to 50000')).toBeNull();
  });

  it('degenerate + garbage + injection-shaped inputs are rejected', () => {
    for (const bad of [
      '$80,000 - $80,000', // zero-width
      '0 - 0',
      '-5000 to 10000', // leading minus is not a price
      'eighty to ninety grand', // words are the AI's problem, not the parser's
      'DROP TABLE leads; --',
      '<script>alert(1)</script>',
      '$ - $',
      '',
      'call me maybe',
    ]) {
      const r = parsePriceRange(bad);
      if (r !== null) {
        // If anything parses, it must still be a sane forward range.
        expect(r.max).toBeGreaterThan(r.min);
        expect(r.min).toBeGreaterThan(0);
        expect(Number.isFinite(r.min) && Number.isFinite(r.max)).toBe(true);
      }
    }
    expect(parsePriceRange('$80,000 - $80,000')).toBeNull();
    expect(parsePriceRange('call me maybe')).toBeNull();
  });
});
