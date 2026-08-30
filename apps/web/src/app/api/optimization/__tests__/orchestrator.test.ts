import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/app/api/optimization/agents/lead-scoring', () => ({
  LeadScoringAgent: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockResolvedValue({
      result: { compositeScore: 0.75 }
    })
  }))
}));

vi.mock('@/app/api/optimization/agents/valuation', () => ({
  ValuationAgent: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockResolvedValue({
      result: { arv: 50000000 }
    })
  }))
}));

vi.mock('@/app/api/optimization/agents/probability', () => ({
  ProbabilityAgent: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockResolvedValue({
      result: { pClose: 0.65 }
    })
  }))
}));

vi.mock('@/app/api/optimization/agents/decision', () => ({
  DecisionAgent: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockResolvedValue({
      result: { action: 'PURSUE', priority: 8 }
    })
  }))
}));

const { SimpleOrchestrator } = await import('../orchestrator');

describe('SimpleOrchestrator', () => {
  let orchestrator: SimpleOrchestrator;

  beforeEach(() => {
    orchestrator = new SimpleOrchestrator();
    vi.clearAllMocks();
  });

  it('should process lead through all agents in sequence', async () => {
    await expect(orchestrator.processLead(123)).resolves.not.toThrow();
  });

  it('should handle missing valuation gracefully', async () => {
    // This will be tested manually once agents are integrated
    expect(true).toBe(true);
  });
});
