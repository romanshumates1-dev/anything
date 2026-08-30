import { LeadScoringAgent } from './agents/lead-scoring';
import { ValuationAgent } from './agents/valuation';
import { ProbabilityAgent } from './agents/probability';
import { DecisionAgent } from './agents/decision';

export class SimpleOrchestrator {
  private agents = {
    leadScoring: new LeadScoringAgent(),
    valuation: new ValuationAgent(),
    probability: new ProbabilityAgent(),
    decision: new DecisionAgent()
  };

  async processLead(leadId: number): Promise<void> {
    console.log(`[Orchestrator] Processing lead ${leadId}`);

    try {
      // Step 1: Score lead
      const scoreResult = await this.agents.leadScoring.execute({ leadId });
      console.log(`[Orchestrator] Lead score: ${scoreResult.result.compositeScore.toFixed(2)}`);

      // Step 2: Value property
      const valuationResult = await this.agents.valuation.execute({ leadId });

      // Early exit if no valuation
      if (!valuationResult.result.arv) {
        console.log(`[Orchestrator] No valuation - skipping lead ${leadId}`);
        return;
      }
      console.log(`[Orchestrator] ARV: $${(valuationResult.result.arv / 100).toFixed(0)}`);

      // Step 3: Calculate probability
      const probabilityResult = await this.agents.probability.execute({ leadId });
      console.log(`[Orchestrator] P(close): ${(probabilityResult.result.pClose * 100).toFixed(1)}%`);

      // Step 4: Make decision
      const decisionResult = await this.agents.decision.execute({ leadId });
      console.log(`[Orchestrator] Decision: ${decisionResult.result.action} (priority: ${decisionResult.result.priority})`);

    } catch (error: any) {
      console.error(`[Orchestrator] Error processing lead ${leadId}:`, error.message);
      throw error;
    }
  }

  async processBatch(leadIds: number[]): Promise<void> {
    console.log(`[Orchestrator] Processing batch of ${leadIds.length} leads`);

    for (const leadId of leadIds) {
      try {
        await this.processLead(leadId);
      } catch (error: any) {
        console.error(`[Orchestrator] Failed to process lead ${leadId}:`, error.message);
        // Continue with next lead
      }
    }

    console.log(`[Orchestrator] Batch complete`);
  }
}
