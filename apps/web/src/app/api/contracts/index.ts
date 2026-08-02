/**
 * Regional Contract Engine
 *
 * Public exports for the contract generation system.
 */

// Main engine
export {
  generateContract,
  validateContractVariables,
  validateStateRequirements,
  detectState,
  loadTemplate,
  getRequiredDisclosures,
  MINIMUM_ASSIGNMENT_FEE,
  BUYER_ENTITY,
  ASSIGNOR_ENTITY,
  MIN_INSPECTION_DAYS,
  PURCHASE_AGREEMENT_DEFAULTS,
  getEarnestMoneyForTier,
  calculateTotalDueAtClosing,
  hasSpecificTemplate,
  type ContractType,
  type DealData,
  type NegotiationRecord,
  type GeneratedContract,
  type ContractValidationResult,
  type BuyerTier,
} from './engine';

// Purchase Agreement Template
export {
  generatePurchaseAgreement,
  validatePurchaseAgreementVariables,
  calculateEarnestMoneyDueDate,
  numberToWords,
  type PurchaseAgreementVariables,
} from './templates/purchase-agreement';

// Assignment Contract Template
export {
  generateAssignmentContract,
  validateAssignmentContractVariables,
  EARNEST_MONEY_BY_TIER,
  type AssignmentContractVariables,
} from './templates/assignment-contract';

// Regional Templates
export {
  generateTexasAddendum,
  getTexasRequiredDisclosures,
  TEXAS_STATE_CODE,
  TEXAS_EARNEST_MONEY_REQUIREMENTS,
  TEXAS_DISCLOSURE_REQUIREMENTS,
  type TexasAddendumVariables,
} from './templates/regional/texas';

export {
  generateFloridaAddendum,
  getFloridaRequiredDisclosures,
  FLORIDA_STATE_CODE,
  FLORIDA_REQUIRED_DISCLOSURES,
  type FloridaAddendumVariables,
} from './templates/regional/florida';

export {
  generateCaliforniaAddendum,
  getCaliforniaRequiredDisclosures,
  CALIFORNIA_STATE_CODE,
  CALIFORNIA_REQUIRED_DISCLOSURES,
  CALIFORNIA_HAZARD_ZONES,
  type CaliforniaAddendumVariables,
} from './templates/regional/california';

export {
  generateGenericAddendum,
  getGenericRequiredDisclosures,
  STANDARD_DISCLOSURES,
  STATES_WITH_SPECIFIC_TEMPLATES,
  type GenericAddendumVariables,
} from './templates/regional/generic';
