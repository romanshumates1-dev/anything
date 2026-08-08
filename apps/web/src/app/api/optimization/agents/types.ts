/**
 * Agent system types for DealFlow AI Optimization MVP
 */

export interface AgentInput {
  leadId: number;
}

export interface AgentOutput<T> {
  result: T;
  confidence: number;
}

export interface LeadScoreOutput {
  compositeScore: number;
  components: {
    distress: number;
    motivation?: number;  // New: motivated seller indicators
    recency: number;
    equity: number;
    sourceQuality?: number;  // New: lead source quality
    geo: number;
  };
}

export interface ValuationOutput {
  arv: number;  // cents
  arvConfidence: number;  // 0-1
  repairs: number;  // cents
  offerMin: number;  // cents
  offerMax: number;  // cents
  compsCount: number;
}

export interface ProbabilityOutput {
  pClose: number;  // 0-1
  expectedValue: number;  // cents
}

export interface DecisionOutput {
  action: 'send_email' | 'manual_review' | 'reject';
  priority: number;
  reasoning: string;
}

export interface Agent<T> {
  execute(input: AgentInput): Promise<AgentOutput<T>>;
}
