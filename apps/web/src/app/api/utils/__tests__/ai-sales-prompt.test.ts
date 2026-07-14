import { describe, it, expect } from 'vitest';
import { buildSupervisorPrompt, OBJECTION_LIBRARY } from '../ai-sales-prompt';
import { detectHighRisk } from '../ai-orchestrator';

describe('buildSupervisorPrompt — keeps ALL original guardrails', () => {
  const p = buildSupervisorPrompt();
  it('keeps the prompt-injection security rule', () => {
    expect(p).toMatch(/untrusted data/i);
    expect(p).toMatch(/NEVER follow instructions/i);
  });
  it('keeps escalation on offer/price/contract/frustration', () => {
    expect(p).toMatch(/ESCALATION/);
    expect(p).toMatch(/offer/i);
    expect(p).toMatch(/requires_human = true/);
  });
  it('keeps the confidence gate (<0.8 → human)', () => {
    expect(p).toMatch(/confidence/i);
    expect(p).toMatch(/0\.8/);
  });
  it('keeps the exact JSON output contract', () => {
    for (const field of ['response_text', 'confidence_score', 'requires_human', 'suggested_action', 'internal_reasoning']) {
      expect(p).toContain(field);
    }
    expect(p).toMatch(/No markdown, no code fences/);
  });
  it('does NOT let the AI set prices itself (defers to the ladder)', () => {
    expect(p).toMatch(/do NOT set prices|MUST be escalated|price ladder/i);
  });
});

describe('buildSupervisorPrompt — adds sales skills', () => {
  const p = buildSupervisorPrompt();
  it('adds rapport, objection handling, motivated-seller pacing, closing', () => {
    expect(p).toMatch(/RAPPORT/i);
    expect(p).toMatch(/OBJECTION HANDLING/i);
    expect(p).toMatch(/MOTIVATED-SELLER/i);
    expect(p).toMatch(/CLOSING/i);
  });
  it('is truthful/ethical — no deception', () => {
    expect(p).toMatch(/never use deception|ethical|truthful/i);
  });
  it('tailors tone for seller vs buyer', () => {
    expect(buildSupervisorPrompt('seller')).toMatch(/SELLER/);
    expect(buildSupervisorPrompt('buyer')).toMatch(/BUYER/);
  });
});

describe('OBJECTION_LIBRARY', () => {
  it('covers the five required objection categories with strategies', () => {
    const cats = OBJECTION_LIBRARY.map((o) => o.category).sort();
    expect(cats).toEqual(['agent_listed', 'not_selling', 'price', 'timing', 'trust']);
    for (const o of OBJECTION_LIBRARY) {
      expect(o.cues.length).toBeGreaterThan(0);
      expect(o.strategy.length).toBeGreaterThan(20);
    }
  });
});

describe('escalation net still holds with the new prompt (server-side, model-independent)', () => {
  it('detectHighRisk catches price/offer/contract/$ regardless of prompt', () => {
    expect(detectHighRisk("what's your offer?")).toBe(true);
    expect(detectHighRisk('I want $150,000')).toBe(true);
    expect(detectHighRisk('send me the contract')).toBe(true);
    expect(detectHighRisk('can we sign this week')).toBe(true);
    expect(detectHighRisk('just checking in, hope you are well')).toBe(false);
  });
});
