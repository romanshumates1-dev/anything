/**
 * Phase P3 — Human-request detector tests.
 *
 * 30-message fixture corpus: explicit asks, embedded-word false-positive traps,
 * normal replies. Zero missed explicit asks, FP rate logged.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { detectHumanRequest, detectHumanRequestKeyword, detectHumanRequestLLM, handleHumanRequest } from './humanRequestDetector';

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn() }));
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));
vi.mock('@/app/api/utils/logger', () => ({ logEvent: vi.fn() }));

import { logEvent } from '@/app/api/utils/logger';

// ─── Fixture Corpus ──────────────────────────────────────────────────────────

interface TestFixture {
  text: string;
  expected: boolean;
  category: string;
  note?: string;
}

const FIXTURES: TestFixture[] = [
  // ── Explicit human requests (should ALL be detected) ──
  { text: 'I want to talk to a real person', expected: true, category: 'explicit' },
  { text: 'Can I speak to a human please', expected: true, category: 'explicit' },
  { text: 'Is this a real person or a bot', expected: true, category: 'explicit' },
  { text: 'Are you a robot', expected: true, category: 'explicit' },
  { text: 'Who is this', expected: true, category: 'explicit' },
  { text: 'Call me at 555-1234', expected: true, category: 'explicit' },
  { text: 'Give me a call when you get this', expected: true, category: 'explicit' },
  { text: 'I need to speak to the owner', expected: true, category: 'explicit' },
  { text: 'Get me the manager', expected: true, category: 'explicit' },
  { text: 'Connect me with a real person', expected: true, category: 'explicit', note: 'LLM pattern' },
  { text: 'I want to talk to someone real', expected: true, category: 'explicit', note: 'LLM pattern' },
  { text: 'This is not helpful, I need a human', expected: true, category: 'explicit', note: 'LLM pattern' },
  { text: 'Put me in touch with a representative', expected: true, category: 'explicit', note: 'LLM pattern' },
  { text: 'Transfer me to a real agent', expected: true, category: 'explicit', note: 'LLM pattern' },
  { text: 'I am looking to speak with a person', expected: true, category: 'explicit', note: 'LLM pattern' },

  // ── False-positive traps (should NOT be detected) ──
  { text: "I read the owner's manual", expected: false, category: 'false_positive_trap' },
  { text: 'Check the owners manual for details', expected: false, category: 'false_positive_trap' },
  { text: 'Call me back tomorrow', expected: false, category: 'false_positive_trap' },
  { text: 'Call me when you have an update', expected: false, category: 'false_positive_trap' },
  { text: 'Who is this from', expected: false, category: 'false_positive_trap' },
  { text: 'Who is this guy you mentioned', expected: false, category: 'false_positive_trap' },
  { text: 'I used to be a manager at a company', expected: false, category: 'false_positive_trap' },
  { text: 'The manager of the property said...', expected: false, category: 'false_positive_trap' },

  // ── Normal replies (should NOT be detected) ──
  { text: 'Yes, I am interested', expected: false, category: 'normal' },
  { text: 'Can you tell me more about the offer', expected: false, category: 'normal' },
  { text: 'What is the price', expected: false, category: 'normal' },
  { text: 'No thanks, not interested', expected: false, category: 'normal' },
  { text: 'Send me the details', expected: false, category: 'normal' },
  { text: 'I need to think about it', expected: false, category: 'normal' },
  { text: 'Thanks for the information', expected: false, category: 'normal' },
];

describe('Human Request Detector', () => {
  describe('Keyword detection', () => {
    it('detects explicit human requests via keywords', () => {
      const explicitFixtures = FIXTURES.filter(f => f.category === 'explicit' && (!f.note || !f.note.includes('LLM')));
      for (const f of explicitFixtures) {
        const result = detectHumanRequestKeyword(f.text);
        expect(result.isHumanRequest).toBe(true);
        expect(result.method).toBe('keyword');
      }
    });

    it('rejects false-positive traps', () => {
      const trapFixtures = FIXTURES.filter(f => f.category === 'false_positive_trap');
      for (const f of trapFixtures) {
        const result = detectHumanRequestKeyword(f.text);
        expect(result.isHumanRequest).toBe(false);
      }
    });

    it('rejects normal replies', () => {
      const normalFixtures = FIXTURES.filter(f => f.category === 'normal');
      for (const f of normalFixtures) {
        const result = detectHumanRequestKeyword(f.text);
        expect(result.isHumanRequest).toBe(false);
      }
    });
  });

  describe('LLM fallback detection', () => {
    it('detects LLM-pattern human requests', () => {
      const llmFixtures = FIXTURES.filter(f => f.note === 'LLM pattern');
      for (const f of llmFixtures) {
        const result = detectHumanRequestLLM(f.text);
        expect(result.isHumanRequest).toBe(true);
        expect(result.method).toBe('llm');
      }
    });
  });

  describe('Combined detection', () => {
    it('detects ALL explicit human requests (zero missed)', () => {
      const explicitFixtures = FIXTURES.filter(f => f.expected === true);
      const missed: string[] = [];

      for (const f of explicitFixtures) {
        const result = detectHumanRequest(f.text);
        if (!result.isHumanRequest) {
          missed.push(f.text);
        }
      }

      expect(missed).toEqual([]);
    });

    it('rejects ALL non-human-request messages', () => {
      const nonHumanFixtures = FIXTURES.filter(f => f.expected === false);
      const falsePositives: string[] = [];

      for (const f of nonHumanFixtures) {
        const result = detectHumanRequest(f.text);
        if (result.isHumanRequest) {
          falsePositives.push(f.text);
        }
      }

      // Log false-positive rate
      const fpRate = (falsePositives.length / nonHumanFixtures.length) * 100;
      console.log(`[P3] False-positive rate: ${fpRate.toFixed(1)}% (${falsePositives.length}/${nonHumanFixtures.length})`);

      // Acceptable: zero false positives on this corpus
      expect(falsePositives).toEqual([]);
    });
  });

  describe('handleHumanRequest tenant scope (independent-review hardening)', () => {
    const lastQuery = () => (mockSql.mock.calls.at(-1)?.[0] ?? []).join('?');
    const argsOf = () => (mockSql.mock.calls.at(-1) ?? []).slice(1);
    const detection = { isHumanRequest: true, method: 'keyword' as const, matchedKeyword: 'call me' };

    beforeEach(() => vi.clearAllMocks());

    it('scopes the write to the (leadId, organizationId) pair — would cross-write without it', async () => {
      mockSql.mockResolvedValueOnce([{ id: 7 }]);
      await handleHumanRequest(7, 'conv-1', 'call me please', 'org_a', detection);
      expect(lastQuery()).toContain('organization_id');
      expect(argsOf()).toContain('org_a');
      expect(argsOf()).toContain(7);
    });

    it('fails closed on a mismatched pair: zero rows updated, audit still records the miss', async () => {
      mockSql.mockResolvedValueOnce([]);
      await handleHumanRequest(7, 'conv-1', 'call me please', 'org_b', detection);
      expect(vi.mocked(logEvent)).toHaveBeenCalledWith(
        'human_request_detected',
        'lead',
        '7',
        expect.objectContaining({ organizationId: 'org_b', tenantScopedWrite: false }),
      );
    });

    it('never attributes the audit row to a user: organizationId travels in the payload, not the user_id slot', async () => {
      mockSql.mockResolvedValueOnce([{ id: 7 }]);
      await handleHumanRequest(7, 'conv-1', 'call me please', 'org_a', detection);
      // logEvent(action, targetType, targetId, payload) — no 5th positional arg.
      expect(vi.mocked(logEvent).mock.calls[0].length).toBe(4);
      expect(vi.mocked(logEvent).mock.calls[0][3]).toMatchObject({ organizationId: 'org_a' });
    });
  });
});