import { describe, it, expect } from 'vitest';
import type { AgentInput, AgentOutput, LeadScoreOutput, ValuationOutput, ProbabilityOutput, DecisionOutput } from '../types';

describe('Agent Types', () => {
  it('should accept valid AgentInput', () => {
    const input: AgentInput = { leadId: 123 };
    expect(input.leadId).toBe(123);
  });

  it('should accept valid AgentOutput', () => {
    const output: AgentOutput<{ score: number }> = {
      result: { score: 0.8 },
      confidence: 0.9
    };
    expect(output.result.score).toBe(0.8);
    expect(output.confidence).toBe(0.9);
  });

  it('should enforce LeadScoreOutput shape', () => {
    const output: LeadScoreOutput = {
      compositeScore: 0.82,
      components: {
        distress: 0.9,
        recency: 0.85,
        equity: 0.7,
        geo: 0.8
      }
    };
    expect(output.compositeScore).toBeGreaterThan(0);
  });

  it('should enforce ValuationOutput shape', () => {
    const output: ValuationOutput = {
      arv: 250000,
      arvConfidence: 0.85,
      repairs: 35000,
      offerMin: 140000,
      offerMax: 160000,
      compsCount: 8
    };
    expect(output.arv).toBeGreaterThan(0);
  });

  it('should enforce ProbabilityOutput shape', () => {
    const output: ProbabilityOutput = {
      pClose: 0.68,
      expectedValue: 6800
    };
    expect(output.pClose).toBeGreaterThanOrEqual(0);
    expect(output.pClose).toBeLessThanOrEqual(1);
  });

  it('should enforce DecisionOutput shape', () => {
    const output: DecisionOutput = {
      action: 'send_email',
      priority: 6800,
      reasoning: 'High probability'
    };
    expect(['send_email', 'manual_review', 'reject']).toContain(output.action);
  });
});
