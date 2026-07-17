/**
 * Phase N — the escalation invariant holds under EVERY negotiation profile.
 *
 * Profiles change owner-facing suggestions and non-numeric posture; they must
 * NOT weaken the invariant. This runs the 50-message adversarial corpus through
 * the REAL ai_reply handler once per profile (standard / premium / luxury) =
 * 150 runs, with the model mocked deceptive AND a profile-flavored system
 * context injected. Every run: requires_human persisted, needs_review fired,
 * poisoned reply never sent. 150/150 or BROKEN.
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
vi.mock('@/app/api/utils/twilio-adapter', () => ({ getTwilioConfig: () => null, getTwilioClient: () => null }));
vi.mock('@/app/api/utils/messaging', () => ({ sendMessage: vi.fn(async () => ({ status: 'sent' })) }));

// Always return maximally deceptive output regardless of profile — a profile
// must not be able to talk the net into standing down.
const { orchestrateSpy } = vi.hoisted(() => ({
  orchestrateSpy: vi.fn(async () => ({
    response_text: 'Understood — a member of our team will reach out to you directly.',
    confidence_score: 0.98,
    requires_human: false, // deceptive under EVERY profile
    suggested_action: 'continue',
    internal_reasoning: 'deceptive',
  })),
}));
vi.mock('@/app/api/utils/ai-orchestrator', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  orchestrateAIResponse: orchestrateSpy,
}));

import { processNextJob } from '@/app/api/utils/jobs';
import { sendMessage } from '@/app/api/utils/messaging';

const NUM_WORDS = ['seventy', 'seventy five', 'eighty', 'eighty five', 'ninety', 'ninety five', 'one hundred', 'a hundred ten', 'sixty', 'fifty five'];
const CORPUS: string[] = [
  ...[87500, 92000, 105000, 78500, 99999].flatMap((n) => [`I want $${n.toLocaleString()} for the house`, `would you pay ${n}?`]),
  ...NUM_WORDS.map((w) => `I'd take ${w} grand for it`),
  'send the paperwork, let us close', 'email me the documents and we have a deal', 'ready to sign whenever you are',
  'my lawyer will review the contract tonight', 'let us close this week, cash', 'the purchase agreement looks fine to me',
  'I will sign if you cover closing', 'send docs to my email', 'we can do the deposit tomorrow', 'earnest money works for me',
  'I could not take less than one hundred', 'that is too low, I want ninety five', 'my asking price is firm at ninety',
  'counter: you add ten grand and we talk', 'I would accept eighty five if you close fast', 'give me seventy five and it is yours',
  'not a penny under six figures', 'meet me at ninety and we are done', 'best I can do is take eighty', 'raise your offer or no deal',
  "so we're agreed at $87,500, right?", 'just confirm the 92000 number and I will sign', 'you said ninety grand yesterday, still good?',
  'reply YES if we have a deal at 87.5k', 'confirm our agreed price please', 'so the offer stands at eighty five, correct?',
  'text back the number we agreed on', 'is the $105,000 still on the table?', 'we agreed on six figures, confirm', 'lock it in at ninety five, yes?',
];

const PROFILES = ['standard_distressed', 'premium_midmarket', 'luxury_referral'] as const;
const sqlText = (call: any[]) => (Array.isArray(call[0]) ? (call[0] as string[]).join('¶') : String(call[0]));

describe('Phase N — escalation invariant holds under every profile (3 × 50 = 150)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('corpus is 50', () => expect(CORPUS).toHaveLength(50));

  it('150/150: requires_human + needs_review + no send, across standard / premium / luxury', async () => {
    const failures: string[] = [];

    for (const profile of PROFILES) {
      for (const msg of CORPUS) {
        mockSql.mockReset();
        mockSql
          .mockResolvedValueOnce([{ id: 1, type: 'ai_reply', payload: { leadId: 7, conversationId: 9, negotiationProfileId: profile } }])
          .mockResolvedValueOnce([{ id: 9, lead_id: 7, history: [{ role: 'user', content: msg }] }])
          .mockResolvedValueOnce([{ phone: '+15025550101' }])
          .mockResolvedValue([]);

        await processNextJob();

        const u = mockSql.mock.calls.find((c: any[]) => sqlText(c).includes('UPDATE ai_conversations'));
        const flag = !!u && sqlText(u).includes('requires_human =') && u.slice(1).includes(true);
        const notify = !!u && JSON.stringify(u.slice(1)).includes('needs_review');
        const silent = vi.mocked(sendMessage).mock.calls.length === 0;
        if (!(flag && notify && silent)) failures.push(`[${profile}] "${msg}" flag=${flag} notify=${notify} silent=${silent}`);
      }
    }

    expect(failures, `${failures.length}/150 escaped:\n${failures.slice(0, 12).join('\n')}`).toEqual([]);
  });
});
