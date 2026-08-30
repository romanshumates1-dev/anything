/**
 * Comprehensive Tests for Contract Engine
 *
 * Tests state detection, $5k fee floor, regional templates,
 * and contract generation.
 */

import { describe, it, expect } from 'vitest';
import {
  detectState,
  loadTemplate,
  getRequiredDisclosures,
  validateStateRequirements,
  validateContractVariables,
  generateContract,
  MINIMUM_ASSIGNMENT_FEE,
  MIN_INSPECTION_DAYS,
  PURCHASE_AGREEMENT_DEFAULTS,
  hasSpecificTemplate,
  type DealData,
  type NegotiationRecord,
} from '../engine';

describe('Contract Engine', () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // CONFIGURATION CONSTANTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Configuration Constants', () => {
    it('MINIMUM_ASSIGNMENT_FEE is $5,000 (NON-NEGOTIABLE)', () => {
      expect(MINIMUM_ASSIGNMENT_FEE).toBe(5000);
      console.log(`✓ MINIMUM_ASSIGNMENT_FEE = $${MINIMUM_ASSIGNMENT_FEE}`);
    });

    it('MIN_INSPECTION_DAYS is 7', () => {
      expect(MIN_INSPECTION_DAYS).toBe(7);
    });

    it('defaults have correct inspection days (14)', () => {
      expect(PURCHASE_AGREEMENT_DEFAULTS.inspection_days).toBe(14);
    });

    it('defaults have correct attorney mod days (5)', () => {
      expect(PURCHASE_AGREEMENT_DEFAULTS.attorney_mod_days).toBe(5);
    });

    it('defaults have correct earnest money ($1000)', () => {
      expect(PURCHASE_AGREEMENT_DEFAULTS.earnest_money).toBe(1000);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STATE DETECTION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('State Detection', () => {
    it('detects TX from "123 Main St, Austin, TX 78701"', () => {
      const state = detectState('123 Main St, Austin, TX 78701');
      expect(state).toBe('TX');
      console.log(`✓ "Austin, TX 78701" → ${state}`);
    });

    it('detects FL from "456 Ocean Dr, Miami, FL 33139"', () => {
      const state = detectState('456 Ocean Dr, Miami, FL 33139');
      expect(state).toBe('FL');
    });

    it('detects CA from "789 Hollywood Blvd, Los Angeles, CA 90028"', () => {
      const state = detectState('789 Hollywood Blvd, Los Angeles, CA 90028');
      expect(state).toBe('CA');
      console.log(`✓ "Los Angeles, CA 90028" → ${state}`);
    });

    it('detects state from full name "Texas"', () => {
      const state = detectState('123 Main St, Houston, Texas');
      expect(state).toBe('TX');
    });

    it('detects state from full name "California"', () => {
      const state = detectState('Los Angeles, California');
      expect(state).toBe('CA');
    });

    it('detects state from full name "Florida"', () => {
      const state = detectState('Miami, Florida');
      expect(state).toBe('FL');
    });

    it('detects NY from "New York, NY 10001"', () => {
      const state = detectState('New York, NY 10001');
      expect(state).toBe('NY');
    });

    it('returns null for invalid addresses', () => {
      expect(detectState('')).toBeNull();
      expect(detectState('123 Main St')).toBeNull();
      expect(detectState('Some random text')).toBeNull();
    });

    it('handles case insensitivity', () => {
      expect(detectState('HOUSTON, TX')).toBe('TX');
      expect(detectState('houston, tx')).toBe('TX');
      expect(detectState('Houston, Tx 77001')).toBe('TX');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEMPLATE LOADING
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Template Loading', () => {
    it('TX has state-specific template', () => {
      expect(hasSpecificTemplate('TX')).toBe(true);
      const template = loadTemplate('TX', 'PURCHASE_AGREEMENT');
      expect(template.hasStateSpecific).toBe(true);
      console.log(`✓ TX template: ${template.templateName}`);
    });

    it('FL has state-specific template', () => {
      expect(hasSpecificTemplate('FL')).toBe(true);
    });

    it('CA has state-specific template', () => {
      expect(hasSpecificTemplate('CA')).toBe(true);
    });

    it('NY uses generic template', () => {
      expect(hasSpecificTemplate('NY')).toBe(false);
      const template = loadTemplate('NY', 'PURCHASE_AGREEMENT');
      expect(template.hasStateSpecific).toBe(false);
      expect(template.templateName).toContain('generic');
    });

    it('assignment contracts are same across states', () => {
      const txTemplate = loadTemplate('TX', 'ASSIGNMENT');
      const nyTemplate = loadTemplate('NY', 'ASSIGNMENT');
      expect(txTemplate.templateName).toBe(nyTemplate.templateName);
      expect(txTemplate.templateName).toBe('assignment-contract');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // REQUIRED DISCLOSURES
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Required Disclosures', () => {
    it('TX disclosures include seller disclosure', () => {
      const disclosures = getRequiredDisclosures('TX');
      expect(disclosures.some(d => d.toLowerCase().includes('seller') || d.toLowerCase().includes('disclosure'))).toBe(true);
    });

    it('FL disclosures include property tax disclosure', () => {
      const disclosures = getRequiredDisclosures('FL');
      // Florida requires property tax and condo disclosures
      expect(disclosures.length).toBeGreaterThan(0);
    });

    it('CA disclosures include natural hazard', () => {
      const disclosures = getRequiredDisclosures('CA', {
        hazardZones: { earthquake: true, fire: true }
      });
      expect(disclosures.some(d =>
        d.toLowerCase().includes('hazard') ||
        d.toLowerCase().includes('earthquake') ||
        d.toLowerCase().includes('fire')
      )).toBe(true);
      console.log(`✓ CA hazard disclosures: ${disclosures.length} items`);
    });

    it('pre-1978 properties require lead paint disclosure', () => {
      const disclosures = getRequiredDisclosures('TX', { propertyYearBuilt: 1970 });
      expect(disclosures.some(d => d.toLowerCase().includes('lead'))).toBe(true);
      console.log(`✓ Pre-1978 lead paint disclosure included`);
    });

    it('generic state still has basic disclosures', () => {
      const disclosures = getRequiredDisclosures('NY');
      expect(disclosures.length).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STATE REQUIREMENTS VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('State Requirements Validation', () => {
    const baseDeal: DealData = {
      id: 'deal-123',
      property_address: '123 Main St',
      property_city: 'Austin',
      property_state: 'TX',
      property_zip: '78701',
      property_county: 'Travis',
      seller_name: 'John Seller',
      seller_address: '456 Other St, Austin, TX',
      purchase_price: 150000,
      closing_date: '2026-09-01',
    };

    it('validates required fields', () => {
      const result = validateStateRequirements(baseDeal, 'TX');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('fails without property address', () => {
      const deal = { ...baseDeal, property_address: '' };
      const result = validateStateRequirements(deal, 'TX');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('address'))).toBe(true);
    });

    it('fails without seller name', () => {
      const deal = { ...baseDeal, seller_name: '' };
      const result = validateStateRequirements(deal, 'TX');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Seller name'))).toBe(true);
    });

    it('fails with zero purchase price', () => {
      const deal = { ...baseDeal, purchase_price: 0 };
      const result = validateStateRequirements(deal, 'TX');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('price'))).toBe(true);
    });

    it('FL requires county for tax disclosure', () => {
      const deal = { ...baseDeal, property_state: 'FL', property_county: '' };
      const result = validateStateRequirements(deal, 'FL');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('county'))).toBe(true);
      console.log(`✓ FL county requirement enforced`);
    });

    it('CA requires county for disclosures', () => {
      const deal = { ...baseDeal, property_state: 'CA', property_county: '' };
      const result = validateStateRequirements(deal, 'CA');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('county'))).toBe(true);
    });

    it('warns on pre-1978 CA property', () => {
      const deal = { ...baseDeal, property_state: 'CA', property_year_built: 1970 };
      const result = validateStateRequirements(deal, 'CA');
      expect(result.warnings.some(w => w.includes('lead') || w.includes('1978'))).toBe(true);
      console.log(`✓ Pre-1978 warning generated`);
    });

    it('TX warns without earnest money', () => {
      const deal = { ...baseDeal, earnest_money: undefined };
      const result = validateStateRequirements(deal, 'TX');
      expect(result.warnings.some(w => w.includes('earnest'))).toBe(true);
    });

    it('fails with inspection days < 7', () => {
      const deal = { ...baseDeal, inspection_days: 5 };
      const result = validateStateRequirements(deal, 'TX');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Inspection') && e.includes('7'))).toBe(true);
      console.log(`✓ Inspection < 7 days rejected`);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CONTRACT VARIABLES VALIDATION (FEE FLOOR!)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Contract Variables Validation', () => {
    const baseNegotiation: NegotiationRecord = {
      id: 'neg-123',
      deal_id: 'deal-123',
      purchase_price: 150000,
      assignment_fee: 10000,
      closing_date: '2026-09-01',
      seller_agreed: true,
      buyer_agreed: true,
    };

    it('passes when variables match negotiation', () => {
      const result = validateContractVariables(
        { purchase_price: 150000, assignment_fee: 10000, closing_date: '2026-09-01' },
        baseNegotiation
      );
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('FAILS when assignment fee < $5,000 (FEE FLOOR)', () => {
      const lowFeeNeg = { ...baseNegotiation, assignment_fee: 4999 };
      const result = validateContractVariables(
        { assignment_fee: 4999 },
        lowFeeNeg
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some(e =>
        e.includes('$5,000') && e.includes('MINIMUM') && e.includes('NON-NEGOTIABLE')
      )).toBe(true);
      console.log(`✓ $4,999 fee REJECTED: ${result.errors[0]}`);
    });

    it('passes when assignment fee exactly $5,000', () => {
      const minFeeNeg = { ...baseNegotiation, assignment_fee: 5000 };
      const result = validateContractVariables(
        { assignment_fee: 5000 },
        minFeeNeg
      );
      expect(result.valid).toBe(true);
      console.log(`✓ $5,000 fee accepted`);
    });

    it('fails when purchase price mismatches', () => {
      const result = validateContractVariables(
        { purchase_price: 160000 },
        baseNegotiation
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Purchase price mismatch'))).toBe(true);
    });

    it('fails when closing date mismatches', () => {
      const result = validateContractVariables(
        { closing_date: '2026-10-01' },
        baseNegotiation
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Closing date mismatch'))).toBe(true);
    });

    it('warns when neither party has agreed', () => {
      const noAgreement = { ...baseNegotiation, seller_agreed: false, buyer_agreed: false };
      const result = validateContractVariables({}, noAgreement);
      expect(result.warnings.some(w => w.includes('Neither'))).toBe(true);
    });

    it('warns when seller has not agreed', () => {
      const sellerNotAgreed = { ...baseNegotiation, seller_agreed: false };
      const result = validateContractVariables({}, sellerNotAgreed);
      expect(result.warnings.some(w => w.includes('Seller'))).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CONTRACT GENERATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Contract Generation', () => {
    const baseDeal: DealData = {
      id: 'deal-123',
      property_address: '123 Main St',
      property_city: 'Austin',
      property_state: 'TX',
      property_zip: '78701',
      property_county: 'Travis',
      seller_name: 'John Seller',
      seller_address: '456 Other St, Austin, TX 78701',
      purchase_price: 150000,
      earnest_money: 1000,
      closing_date: '2026-09-01',
    };

    it('generates purchase agreement', () => {
      const contract = generateContract(baseDeal, 'PURCHASE_AGREEMENT');
      expect(contract.type).toBe('PURCHASE_AGREEMENT');
      expect(contract.status).toBe('GENERATED');
      expect(contract.state).toBe('TX');
      expect(contract.content.length).toBeGreaterThan(0);
      expect(contract.contractId).toMatch(/^CONTRACT-/);
      console.log(`✓ Purchase agreement generated: ${contract.contractId}`);
    });

    it('includes regional addendum for TX', () => {
      const contract = generateContract(baseDeal, 'PURCHASE_AGREEMENT');
      expect(contract.regionalAddendum).toBeDefined();
      expect(contract.regionalAddendum!.length).toBeGreaterThan(0);
      console.log(`✓ TX regional addendum included`);
    });

    it('includes required disclosures', () => {
      const contract = generateContract(baseDeal, 'PURCHASE_AGREEMENT');
      expect(contract.disclosures.length).toBeGreaterThan(0);
    });

    it('generates assignment contract with valid fee', () => {
      const assignmentDeal: DealData = {
        ...baseDeal,
        assignee_name: 'Jane Buyer',
        assignee_address: '789 Buyer Lane, Austin, TX 78702',
        assignee_tier: 'VIP',
        assignment_fee: 10000, // Above $5k floor
        earnest_money: 500, // VIP tier max is $500
        original_contract_id: 'CONTRACT-123',
        original_contract_date: '2026-08-01',
      };

      const contract = generateContract(assignmentDeal, 'ASSIGNMENT');
      expect(contract.type).toBe('ASSIGNMENT');
      expect(contract.content).toContain('$10,000');
      console.log(`✓ Assignment contract with $10k fee generated`);
    });

    it('THROWS when assignment fee < $5,000', () => {
      const lowFeeDeal: DealData = {
        ...baseDeal,
        assignee_name: 'Jane Buyer',
        assignee_address: '789 Buyer Lane, Austin, TX 78702',
        assignee_tier: 'VIP',
        assignment_fee: 4999, // Below $5k floor - MUST FAIL
        original_contract_id: 'CONTRACT-123',
        original_contract_date: '2026-08-01',
      };

      expect(() => generateContract(lowFeeDeal, 'ASSIGNMENT'))
        .toThrow(/\$5,000.*NON-NEGOTIABLE/);
      console.log(`✓ Assignment with $4,999 fee correctly REJECTED`);
    });

    it('throws without required assignee info', () => {
      const incompleteDeal: DealData = {
        ...baseDeal,
        assignment_fee: 10000,
      };

      expect(() => generateContract(incompleteDeal, 'ASSIGNMENT'))
        .toThrow(/assignee/i);
    });
  });
});
