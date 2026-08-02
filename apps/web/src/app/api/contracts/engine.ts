/**
 * Regional Contract Engine
 *
 * Core engine for generating and validating real estate contracts
 * with state-specific templates and compliance requirements.
 */

import {
  generatePurchaseAgreement,
  validatePurchaseAgreementVariables,
  type PurchaseAgreementVariables,
  PURCHASE_AGREEMENT_DEFAULTS,
  MIN_INSPECTION_DAYS,
  BUYER_ENTITY,
} from './templates/purchase-agreement';

import {
  generateAssignmentContract,
  validateAssignmentContractVariables,
  type AssignmentContractVariables,
  type BuyerTier,
  MINIMUM_ASSIGNMENT_FEE,
  getEarnestMoneyForTier,
  calculateTotalDueAtClosing,
  ASSIGNOR_ENTITY,
} from './templates/assignment-contract';

import {
  generateTexasAddendum,
  getTexasRequiredDisclosures,
  type TexasAddendumVariables,
  TEXAS_STATE_CODE,
} from './templates/regional/texas';

import {
  generateFloridaAddendum,
  getFloridaRequiredDisclosures,
  type FloridaAddendumVariables,
  FLORIDA_STATE_CODE,
} from './templates/regional/florida';

import {
  generateCaliforniaAddendum,
  getCaliforniaRequiredDisclosures,
  type CaliforniaAddendumVariables,
  CALIFORNIA_STATE_CODE,
} from './templates/regional/california';

import {
  generateGenericAddendum,
  getGenericRequiredDisclosures,
  hasSpecificTemplate,
  type GenericAddendumVariables,
} from './templates/regional/generic';

export type ContractType = 'PURCHASE_AGREEMENT' | 'ASSIGNMENT';

export interface DealData {
  id: string;
  property_address: string;
  property_city: string;
  property_state: string;
  property_zip: string;
  property_county: string;
  property_parcel_id?: string;
  property_legal_description?: string;
  property_year_built?: number;

  seller_name: string;
  seller_address: string;
  seller_phone?: string;
  seller_email?: string;

  purchase_price: number;
  earnest_money?: number;
  closing_date: string;
  contract_date?: string;
  inspection_days?: number;
  attorney_mod_days?: number;

  // Assignment-specific
  assignee_name?: string;
  assignee_address?: string;
  assignee_phone?: string;
  assignee_email?: string;
  assignee_company?: string;
  assignee_tier?: BuyerTier;
  assignment_fee?: number;
  original_contract_id?: string;
  original_contract_date?: string;

  // Regional specifics
  hoa?: boolean;
  condominium?: boolean;
  well_water?: boolean;
  septic_system?: boolean;
  flood_zone?: string;
  special_flood_hazard_area?: boolean;
  earthquake_fault_zone?: boolean;
  fire_hazard_zone?: boolean;

  additional_terms?: string;
  metadata?: Record<string, unknown>;
}

export interface NegotiationRecord {
  id: string;
  deal_id: string;
  purchase_price: number;
  assignment_fee: number;
  closing_date: string;
  agreed_price?: number;
  seller_agreed?: boolean;
  buyer_agreed?: boolean;
}

export interface GeneratedContract {
  contractId: string;
  type: ContractType;
  content: string;
  regionalAddendum?: string;
  status: 'GENERATED' | 'PENDING_REVIEW' | 'READY_FOR_SIGNATURE';
  state: string;
  disclosures: string[];
  generatedAt: string;
  variables: Record<string, unknown>;
}

export interface ContractValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * US State codes to full names mapping
 */
const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia',
};

/**
 * State abbreviation aliases
 */
const STATE_ALIASES: Record<string, string> = {
  'TEXAS': 'TX', 'FLORIDA': 'FL', 'CALIFORNIA': 'CA',
  'NEW YORK': 'NY', 'NEWYORK': 'NY',
  'NORTH CAROLINA': 'NC', 'NORTHCAROLINA': 'NC',
  'SOUTH CAROLINA': 'SC', 'SOUTHCAROLINA': 'SC',
  'NEW JERSEY': 'NJ', 'NEWJERSEY': 'NJ',
  'DISTRICT OF COLUMBIA': 'DC', 'WASHINGTON DC': 'DC', 'WASHINGTON D.C.': 'DC',
};

/**
 * Detect state from address string
 */
export function detectState(address: string): string | null {
  if (!address || typeof address !== 'string') {
    return null;
  }

  const normalized = address.toUpperCase().trim();

  // Try to find 2-letter state code (common formats: "City, ST" or "City, ST ZIP")
  // Match patterns like ", TX", ", TX 75001", " TX ", " TX,", etc.
  const stateCodeMatch = normalized.match(/[,\s]([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/);
  if (stateCodeMatch) {
    const code = stateCodeMatch[1];
    if (STATE_NAMES[code]) {
      return code;
    }
  }

  // Try alternate pattern: state code anywhere after comma
  const altMatch = normalized.match(/,\s*([A-Z]{2})\b/);
  if (altMatch) {
    const code = altMatch[1];
    if (STATE_NAMES[code]) {
      return code;
    }
  }

  // Try full state name
  for (const [code, name] of Object.entries(STATE_NAMES)) {
    if (normalized.includes(name.toUpperCase())) {
      return code;
    }
  }

  // Try aliases
  for (const [alias, code] of Object.entries(STATE_ALIASES)) {
    if (normalized.includes(alias)) {
      return code;
    }
  }

  return null;
}

/**
 * Load appropriate template based on state and contract type
 */
export function loadTemplate(
  state: string,
  type: ContractType
): {
  templateName: string;
  hasStateSpecific: boolean;
  stateCode: string;
} {
  const stateCode = state.toUpperCase();
  const hasStateSpecific = hasSpecificTemplate(stateCode);

  let templateName: string;
  switch (type) {
    case 'PURCHASE_AGREEMENT':
      templateName = hasStateSpecific
        ? `purchase-agreement-${stateCode.toLowerCase()}`
        : 'purchase-agreement-generic';
      break;
    case 'ASSIGNMENT':
      templateName = 'assignment-contract'; // Assignment is the same across states
      break;
    default:
      templateName = 'unknown';
  }

  return {
    templateName,
    hasStateSpecific,
    stateCode,
  };
}

/**
 * Get required disclosures for a state
 */
export function getRequiredDisclosures(
  state: string,
  options?: {
    propertyYearBuilt?: number;
    isCondominium?: boolean;
    hasHOA?: boolean;
    hazardZones?: { flood?: boolean; earthquake?: boolean; fire?: boolean };
    wellWater?: boolean;
    septicSystem?: boolean;
    floodZone?: string;
  }
): string[] {
  const stateCode = state.toUpperCase();

  switch (stateCode) {
    case TEXAS_STATE_CODE:
      return getTexasRequiredDisclosures(options?.propertyYearBuilt);

    case FLORIDA_STATE_CODE:
      return getFloridaRequiredDisclosures(
        options?.propertyYearBuilt,
        options?.isCondominium,
        options?.hasHOA
      );

    case CALIFORNIA_STATE_CODE:
      return getCaliforniaRequiredDisclosures(
        options?.propertyYearBuilt,
        options?.hazardZones
      );

    default:
      return getGenericRequiredDisclosures(options?.propertyYearBuilt, {
        hoa: options?.hasHOA,
        wellWater: options?.wellWater,
        septicSystem: options?.septicSystem,
        floodZone: options?.floodZone,
      });
  }
}

/**
 * Validate state-specific requirements for a contract
 */
export function validateStateRequirements(
  deal: DealData,
  state: string
): ContractValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const stateCode = state.toUpperCase();

  // Common validations
  if (!deal.property_address) {
    errors.push('Property address is required');
  }
  if (!deal.seller_name) {
    errors.push('Seller name is required');
  }
  if (!deal.purchase_price || deal.purchase_price <= 0) {
    errors.push('Valid purchase price is required');
  }

  // State-specific validations
  switch (stateCode) {
    case TEXAS_STATE_CODE:
      // Texas requires earnest money
      if (!deal.earnest_money || deal.earnest_money <= 0) {
        warnings.push('Texas contracts typically require earnest money deposit');
      }
      break;

    case FLORIDA_STATE_CODE:
      // Florida requires county for tax disclosure
      if (!deal.property_county) {
        errors.push('Property county is required for Florida property tax disclosure');
      }
      break;

    case CALIFORNIA_STATE_CODE:
      // California requires extensive disclosures
      if (!deal.property_county) {
        errors.push('Property county is required for California disclosures');
      }
      if (deal.property_year_built && deal.property_year_built < 1978) {
        warnings.push('Pre-1978 property requires lead-based paint disclosure with 10-day inspection period');
      }
      break;

    default:
      // Generic validations
      if (!deal.property_county) {
        warnings.push('Property county recommended for proper disclosures');
      }
  }

  // Inspection period validation
  if (deal.inspection_days !== undefined && deal.inspection_days < MIN_INSPECTION_DAYS) {
    errors.push(`Inspection period must be at least ${MIN_INSPECTION_DAYS} days`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Generate regional addendum based on state
 */
function generateRegionalAddendum(deal: DealData, state: string): string | undefined {
  const stateCode = state.toUpperCase();
  const contractDate = deal.contract_date || new Date().toISOString().split('T')[0];

  switch (stateCode) {
    case TEXAS_STATE_CODE: {
      const texasVars: TexasAddendumVariables = {
        property_address: `${deal.property_address}, ${deal.property_city}, ${deal.property_state} ${deal.property_zip}`,
        contract_date: contractDate,
        seller_name: deal.seller_name,
        buyer_name: BUYER_ENTITY,
        earnest_money: deal.earnest_money || PURCHASE_AGREEMENT_DEFAULTS.earnest_money,
        property_year_built: deal.property_year_built,
        hoa_addendum_attached: deal.hoa,
        seller_disclosure_attached: false, // To be provided by seller
      };
      return generateTexasAddendum(texasVars);
    }

    case FLORIDA_STATE_CODE: {
      const floridaVars: FloridaAddendumVariables = {
        property_address: `${deal.property_address}, ${deal.property_city}, ${deal.property_state} ${deal.property_zip}`,
        contract_date: contractDate,
        seller_name: deal.seller_name,
        buyer_name: BUYER_ENTITY,
        purchase_price: deal.purchase_price,
        property_year_built: deal.property_year_built,
        property_county: deal.property_county,
        condominium: deal.condominium,
        hoa: deal.hoa,
        flood_zone: deal.flood_zone,
      };
      return generateFloridaAddendum(floridaVars);
    }

    case CALIFORNIA_STATE_CODE: {
      const californiaVars: CaliforniaAddendumVariables = {
        property_address: `${deal.property_address}`,
        contract_date: contractDate,
        seller_name: deal.seller_name,
        buyer_name: BUYER_ENTITY,
        purchase_price: deal.purchase_price,
        property_year_built: deal.property_year_built,
        property_county: deal.property_county,
        property_city: deal.property_city,
        special_flood_hazard_area: deal.special_flood_hazard_area,
        earthquake_fault_zone: deal.earthquake_fault_zone,
        fire_hazard_zone: deal.fire_hazard_zone,
      };
      return generateCaliforniaAddendum(californiaVars);
    }

    default: {
      const genericVars: GenericAddendumVariables = {
        property_address: `${deal.property_address}, ${deal.property_city}, ${deal.property_state} ${deal.property_zip}`,
        contract_date: contractDate,
        seller_name: deal.seller_name,
        buyer_name: BUYER_ENTITY,
        property_state: deal.property_state,
        property_county: deal.property_county,
        property_year_built: deal.property_year_built,
        hoa: deal.hoa,
        well_water: deal.well_water,
        septic_system: deal.septic_system,
        flood_zone: deal.flood_zone,
      };
      return generateGenericAddendum(genericVars);
    }
  }
}

/**
 * Generate a complete contract with regional template
 */
export function generateContract(
  deal: DealData,
  type: ContractType
): GeneratedContract {
  const state = deal.property_state || detectState(deal.property_address) || 'UNKNOWN';
  const contractDate = deal.contract_date || new Date().toISOString().split('T')[0];

  // Validate state requirements
  const validation = validateStateRequirements(deal, state);
  if (!validation.valid) {
    throw new Error(`Contract validation failed: ${validation.errors.join(', ')}`);
  }

  let content: string;
  let variables: Record<string, unknown>;

  if (type === 'PURCHASE_AGREEMENT') {
    const purchaseVars: PurchaseAgreementVariables = {
      seller_name: deal.seller_name,
      seller_address: deal.seller_address,
      seller_phone: deal.seller_phone,
      seller_email: deal.seller_email,
      property_address: deal.property_address,
      property_city: deal.property_city,
      property_state: deal.property_state,
      property_zip: deal.property_zip,
      property_county: deal.property_county,
      property_legal_description: deal.property_legal_description,
      property_parcel_id: deal.property_parcel_id,
      purchase_price: deal.purchase_price,
      earnest_money: deal.earnest_money || PURCHASE_AGREEMENT_DEFAULTS.earnest_money,
      closing_date: deal.closing_date,
      inspection_days: deal.inspection_days || PURCHASE_AGREEMENT_DEFAULTS.inspection_days,
      attorney_mod_days: deal.attorney_mod_days || PURCHASE_AGREEMENT_DEFAULTS.attorney_mod_days,
      contract_date: contractDate,
      additional_terms: deal.additional_terms,
    };

    const purchaseValidation = validatePurchaseAgreementVariables(purchaseVars);
    if (!purchaseValidation.valid) {
      throw new Error(`Purchase agreement validation failed: ${purchaseValidation.errors.join(', ')}`);
    }

    content = generatePurchaseAgreement(purchaseVars);
    variables = purchaseVars as unknown as Record<string, unknown>;

  } else if (type === 'ASSIGNMENT') {
    if (!deal.assignee_name || !deal.assignee_address || !deal.assignee_tier) {
      throw new Error('Assignment contract requires assignee_name, assignee_address, and assignee_tier');
    }
    if (!deal.assignment_fee || deal.assignment_fee < MINIMUM_ASSIGNMENT_FEE) {
      throw new Error(`Assignment fee must be at least $${MINIMUM_ASSIGNMENT_FEE.toLocaleString()} (NON-NEGOTIABLE)`);
    }
    if (!deal.original_contract_id || !deal.original_contract_date) {
      throw new Error('Assignment contract requires original_contract_id and original_contract_date');
    }

    const tierReqs = getEarnestMoneyForTier(deal.assignee_tier);
    const earnestMoney = deal.earnest_money || tierReqs.default;

    const assignmentVars: AssignmentContractVariables = {
      original_contract_id: deal.original_contract_id,
      original_contract_date: deal.original_contract_date,
      property_address: deal.property_address,
      property_city: deal.property_city,
      property_state: deal.property_state,
      property_zip: deal.property_zip,
      original_purchase_price: deal.purchase_price,
      original_seller_name: deal.seller_name,
      assignee_name: deal.assignee_name,
      assignee_address: deal.assignee_address,
      assignee_phone: deal.assignee_phone,
      assignee_email: deal.assignee_email,
      assignee_company: deal.assignee_company,
      assignee_tier: deal.assignee_tier,
      assignment_fee: deal.assignment_fee,
      earnest_money_deposit: earnestMoney,
      assignment_date: contractDate,
      closing_date: deal.closing_date,
      additional_terms: deal.additional_terms,
    };

    const assignmentValidation = validateAssignmentContractVariables(assignmentVars);
    if (!assignmentValidation.valid) {
      throw new Error(`Assignment contract validation failed: ${assignmentValidation.errors.join(', ')}`);
    }

    content = generateAssignmentContract(assignmentVars);
    variables = assignmentVars as unknown as Record<string, unknown>;

  } else {
    throw new Error(`Unknown contract type: ${type}`);
  }

  // Generate regional addendum
  const regionalAddendum = generateRegionalAddendum(deal, state);

  // Get required disclosures
  const disclosures = getRequiredDisclosures(state, {
    propertyYearBuilt: deal.property_year_built,
    isCondominium: deal.condominium,
    hasHOA: deal.hoa,
    hazardZones: {
      flood: deal.special_flood_hazard_area,
      earthquake: deal.earthquake_fault_zone,
      fire: deal.fire_hazard_zone,
    },
    wellWater: deal.well_water,
    septicSystem: deal.septic_system,
    floodZone: deal.flood_zone,
  });

  return {
    contractId: `CONTRACT-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
    type,
    content,
    regionalAddendum,
    status: 'GENERATED',
    state,
    disclosures,
    generatedAt: new Date().toISOString(),
    variables,
  };
}

/**
 * Validate contract variables against negotiation record
 *
 * Ensures the contract accurately reflects the negotiated terms.
 */
export function validateContractVariables(
  contractVars: {
    purchase_price?: number;
    assignment_fee?: number;
    closing_date?: string;
  },
  negotiation: NegotiationRecord
): ContractValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate purchase price matches
  if (contractVars.purchase_price !== undefined) {
    if (contractVars.purchase_price !== negotiation.purchase_price) {
      errors.push(
        `Purchase price mismatch: contract has $${contractVars.purchase_price.toLocaleString()}, ` +
        `negotiation has $${negotiation.purchase_price.toLocaleString()}`
      );
    }
  }

  // Validate assignment fee - HARD FLOOR ENFORCEMENT
  if (contractVars.assignment_fee !== undefined) {
    if (contractVars.assignment_fee < MINIMUM_ASSIGNMENT_FEE) {
      errors.push(
        `Assignment fee $${contractVars.assignment_fee.toLocaleString()} is below the ` +
        `MINIMUM of $${MINIMUM_ASSIGNMENT_FEE.toLocaleString()} (NON-NEGOTIABLE)`
      );
    }
    if (contractVars.assignment_fee !== negotiation.assignment_fee) {
      errors.push(
        `Assignment fee mismatch: contract has $${contractVars.assignment_fee.toLocaleString()}, ` +
        `negotiation has $${negotiation.assignment_fee.toLocaleString()}`
      );
    }
  }

  // Validate closing date matches
  if (contractVars.closing_date !== undefined) {
    const contractDate = new Date(contractVars.closing_date).toISOString().split('T')[0];
    const negotiationDate = new Date(negotiation.closing_date).toISOString().split('T')[0];

    if (contractDate !== negotiationDate) {
      errors.push(
        `Closing date mismatch: contract has ${contractDate}, negotiation has ${negotiationDate}`
      );
    }
  }

  // Warning if neither party has agreed yet
  if (!negotiation.seller_agreed && !negotiation.buyer_agreed) {
    warnings.push('Neither seller nor buyer has agreed to the negotiated terms yet');
  } else if (!negotiation.seller_agreed) {
    warnings.push('Seller has not yet agreed to the negotiated terms');
  } else if (!negotiation.buyer_agreed) {
    warnings.push('Buyer has not yet agreed to the negotiated terms');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// Re-export constants and types for external use
export {
  MINIMUM_ASSIGNMENT_FEE,
  BUYER_ENTITY,
  ASSIGNOR_ENTITY,
  MIN_INSPECTION_DAYS,
  PURCHASE_AGREEMENT_DEFAULTS,
  getEarnestMoneyForTier,
  calculateTotalDueAtClosing,
  hasSpecificTemplate,
};

export type {
  PurchaseAgreementVariables,
  AssignmentContractVariables,
  BuyerTier,
  TexasAddendumVariables,
  FloridaAddendumVariables,
  CaliforniaAddendumVariables,
  GenericAddendumVariables,
};
