export interface CounterOfferStep {
  step: number;
  offer: number;
  tactic: string;
}

export interface RiskAssessment {
  repairRisk: 'low' | 'medium' | 'high';
  marketRisk: 'low' | 'medium' | 'high';
  timingRisk: 'low' | 'medium' | 'high';
  summary: string;
}

export interface NegotiationGuidance {
  recommendedInitialOffer: number;
  walkAwayPrice: number;
  counterOfferStrategy: CounterOfferStep[];
  negotiationScript: string;
  sellerPsychologySummary: string;
  buyerExitStrategy: string;
  riskAssessment: RiskAssessment;
  assignmentFeasibility: 'high' | 'medium' | 'low';
  estimatedDaysToDisposition: number;
  confidenceScore: number;
  reasoningSummary: string;
}