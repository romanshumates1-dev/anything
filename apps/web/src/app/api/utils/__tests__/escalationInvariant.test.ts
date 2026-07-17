/**
 * INT-2/P3 — the escalation invariant's detector layer.
 *
 * The ceiling in this system is the AI's AUTHORITY, not a dollar figure
 * (owner decision, 2026-07-15): any price/contract/agreement talk must route
 * to a human. detectHighRisk is the server-side safety net; these tests pin
 * the five owner-mandated corpus classes. The full 50-run adversarial fuzz
 * lives in the P3 suite; this file is the fast per-commit guard.
 */
import { describe, it, expect } from 'vitest';
import { detectHighRisk } from '../ai-orchestrator';
import { VOICE_SCRIPT_NO_NUMBERS, MOCK_TRANSCRIPTS } from '@/app/api/gateway/voice-gateway';

describe('detectHighRisk — five corpus classes (owner-mandated)', () => {
  const CLASSES: Record<string, string[]> = {
    'plain formats': ['I want $87,500 for it', 'I want 87500', 'would you do 87.5k', 'maybe 90k cash'],
    'spelled-out prices': ["I'd take ninety grand", 'looking for six figures', "I'd accept ninety for it"],
    'contract talk, zero digits': ['send the paperwork, let us close', 'email me the documents to sign', 'ready to close whenever'],
    'counteroffer language': ['I could not take less than one hundred', 'my asking price is firm', 'can you offer thousand more'],
    'confirmation extraction': ["so we're agreed at $87,500, right?", 'we agreed on the price yesterday, correct?'],
  };

  for (const [cls, samples] of Object.entries(CLASSES)) {
    it(`${cls}: every sample escalates`, () => {
      for (const s of samples) {
        expect(detectHighRisk(s), `should escalate: "${s}"`).toBe(true);
      }
    });
  }

  it('neutral conversation does not blanket-escalate', () => {
    for (const s of ['who is this?', 'yes I own the house', 'call me tomorrow morning', 'not interested, thanks']) {
      expect(detectHighRisk(s), `should NOT escalate: "${s}"`).toBe(false);
    }
  });
});

describe('the spoken script states NO numbers (strict, loosened only deliberately)', () => {
  it('VOICE_SCRIPT_NO_NUMBERS contains zero digits and zero currency tokens', () => {
    expect(VOICE_SCRIPT_NO_NUMBERS).not.toMatch(/[0-9]/);
    expect(VOICE_SCRIPT_NO_NUMBERS).not.toMatch(/[$€£]/);
    expect(VOICE_SCRIPT_NO_NUMBERS.toLowerCase()).not.toMatch(/\b(thousand|hundred|grand|dollars?)\b/);
  });

  it('every price-bearing mock transcript trips the detector (mock corpus is honest)', () => {
    for (const t of MOCK_TRANSCRIPTS.filter((t) => t.priceBearing)) {
      expect(detectHighRisk(t.text), `price-bearing must escalate: "${t.text}"`).toBe(true);
    }
  });
});
