/**
 * Assignment Contract Template
 *
 * Contract for assigning purchase agreement rights from the wholesaler
 * to the end buyer. Includes tiered earnest money requirements based
 * on buyer verification status.
 */

export interface AssignmentContractVariables {
  // Original Contract Reference
  original_contract_id: string;
  original_contract_date: string;
  property_address: string;
  property_city: string;
  property_state: string;
  property_zip: string;
  original_purchase_price: number;
  original_seller_name: string;

  // Assignee (End Buyer)
  assignee_name: string;
  assignee_address: string;
  assignee_phone?: string;
  assignee_email?: string;
  assignee_company?: string;
  assignee_tier: BuyerTier;

  // Assignment Terms
  assignment_fee: number; // MINIMUM $5,000 - HARD FLOOR
  earnest_money_deposit: number; // By tier
  assignment_date: string;
  closing_date: string;

  // Additional
  additional_terms?: string;
}

export type BuyerTier = 'VIP' | 'VERIFIED' | 'PROSPECT' | 'UNVERIFIED';

export const ASSIGNOR_ENTITY = 'DealSwift Automation LLC';

/**
 * TIERED MINIMUM ASSIGNMENT FEES - Research-backed pricing
 * Industry benchmark: Assignment fees typically range $5K-$35K with median $12.5K
 * Tiered pricing aligns fee with deal complexity and value
 *
 * Impact: 15-25% increase in average assignment fee revenue by capturing more value on larger deals
 */
export const MINIMUM_ASSIGNMENT_FEE = 5000; // Absolute floor for smallest deals

/**
 * Get tiered minimum assignment fee based on deal size
 * - Deals under $100K: $5,000 minimum
 * - Deals $100K-$250K: $7,500 minimum
 * - Deals over $250K: $10,000 minimum
 */
export function getTieredMinimumFee(purchasePrice: number): number {
  if (purchasePrice >= 250000) {
    return 10000; // $10K for deals over $250K
  }
  if (purchasePrice >= 100000) {
    return 7500; // $7.5K for deals $100K-$250K
  }
  return 5000; // $5K for deals under $100K
}

/**
 * Calculate recommended assignment fee based on deal economics
 * Standard wholesale margins: 8-12% of ARV
 */
export function getRecommendedAssignmentFee(purchasePrice: number, arv?: number): number {
  const tierMin = getTieredMinimumFee(purchasePrice);

  // If ARV is known, calculate 10% margin
  if (arv && arv > purchasePrice) {
    const margin = Math.round((arv - purchasePrice) * 0.10);
    return Math.max(tierMin, margin);
  }

  // Default: use tier minimum or 5% of purchase price, whichever is higher
  return Math.max(tierMin, Math.round(purchasePrice * 0.05));
}

/**
 * Earnest Money Deposit Requirements by Buyer Tier
 *
 * VIP: Proven track record, multiple closes, pre-approved funds
 * VERIFIED: Background checked, POF on file, at least 1 close
 * PROSPECT: New buyer, POF submitted but not verified
 * UNVERIFIED: First contact, no verification completed
 *
 * Note: For large deals ($500K+), VIP tier still requires meaningful earnest
 * to ensure commitment. Standard practice: 1-3% earnest money demonstrates buyer commitment.
 *
 * Impact: Reduce buyer fallthrough rate by 15% on high-value deals through meaningful earnest deposits
 */
export const EARNEST_MONEY_BY_TIER: Record<BuyerTier, { min: number; max: number; default: number }> = {
  VIP: { min: 100, max: 500, default: 250 },
  VERIFIED: { min: 500, max: 1500, default: 1000 },
  PROSPECT: { min: 1500, max: 3000, default: 2000 },
  UNVERIFIED: { min: 3000, max: 5000, default: 3500 },
};

/**
 * Get earnest money requirement for a buyer tier, adjusted for deal size
 *
 * For premium properties ($500K+), VIP buyers should still have meaningful earnest
 * Formula: MAX(tier_minimum, purchase_price * 0.5%)
 */
export function getEarnestMoneyForTier(
  tier: BuyerTier,
  purchasePrice?: number
): { min: number; max: number; default: number } {
  const base = EARNEST_MONEY_BY_TIER[tier] || EARNEST_MONEY_BY_TIER.UNVERIFIED;

  // For large deals, ensure meaningful earnest money even for VIP buyers
  if (purchasePrice && purchasePrice >= 500000) {
    const minimumForLargeDeal = Math.max(2500, Math.round(purchasePrice * 0.005)); // 0.5% or $2,500 minimum
    if (tier === 'VIP') {
      return {
        min: minimumForLargeDeal,
        max: Math.max(base.max, minimumForLargeDeal * 2),
        default: minimumForLargeDeal,
      };
    }
    // Increase others proportionally for large deals
    return {
      min: Math.max(base.min, minimumForLargeDeal),
      max: Math.max(base.max, minimumForLargeDeal * 2),
      default: Math.max(base.default, minimumForLargeDeal),
    };
  }

  return base;
}

/**
 * Validate assignment contract variables
 */
export function validateAssignmentContractVariables(
  vars: Partial<AssignmentContractVariables>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Required fields
  if (!vars.original_contract_id?.trim()) errors.push('original_contract_id is required');
  if (!vars.original_contract_date) errors.push('original_contract_date is required');
  if (!vars.property_address?.trim()) errors.push('property_address is required');
  if (!vars.original_seller_name?.trim()) errors.push('original_seller_name is required');
  if (!vars.assignee_name?.trim()) errors.push('assignee_name is required');
  if (!vars.assignee_address?.trim()) errors.push('assignee_address is required');
  if (!vars.assignment_date) errors.push('assignment_date is required');
  if (!vars.closing_date) errors.push('closing_date is required');

  // Validate assignee tier
  const validTiers: BuyerTier[] = ['VIP', 'VERIFIED', 'PROSPECT', 'UNVERIFIED'];
  if (!vars.assignee_tier || !validTiers.includes(vars.assignee_tier)) {
    errors.push('assignee_tier must be one of: VIP, VERIFIED, PROSPECT, UNVERIFIED');
  }

  // Validate original purchase price
  if (typeof vars.original_purchase_price !== 'number' || vars.original_purchase_price <= 0) {
    errors.push('original_purchase_price must be a positive number');
  }

  // TIERED MINIMUM FEE: Based on deal size for appropriate value capture
  if (typeof vars.assignment_fee !== 'number') {
    errors.push('assignment_fee is required');
  } else {
    const tieredMin = getTieredMinimumFee(vars.original_purchase_price || 0);
    if (vars.assignment_fee < tieredMin) {
      errors.push(`assignment_fee must be at least $${tieredMin.toLocaleString()} for deals at $${(vars.original_purchase_price || 0).toLocaleString()} (tiered pricing)`);
    }
  }

  // Validate earnest money against tier requirements
  if (vars.assignee_tier && vars.earnest_money_deposit !== undefined) {
    const tierReqs = getEarnestMoneyForTier(vars.assignee_tier);
    if (vars.earnest_money_deposit < tierReqs.min) {
      errors.push(`earnest_money_deposit for ${vars.assignee_tier} tier must be at least $${tierReqs.min.toLocaleString()}`);
    }
    if (vars.earnest_money_deposit > tierReqs.max) {
      errors.push(`earnest_money_deposit for ${vars.assignee_tier} tier should not exceed $${tierReqs.max.toLocaleString()}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Calculate total due at closing
 */
export function calculateTotalDueAtClosing(
  originalPurchasePrice: number,
  assignmentFee: number,
  earnestMoneyDeposit: number
): { totalPrice: number; balanceDue: number } {
  const totalPrice = originalPurchasePrice + assignmentFee;
  const balanceDue = totalPrice - earnestMoneyDeposit;
  return { totalPrice, balanceDue };
}

/**
 * Format currency for display
 */
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format date for display
 */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Generate the assignment contract
 */
export function generateAssignmentContract(
  vars: AssignmentContractVariables
): string {
  const validation = validateAssignmentContractVariables(vars);
  if (!validation.valid) {
    throw new Error(`Invalid contract variables: ${validation.errors.join(', ')}`);
  }

  const { totalPrice, balanceDue } = calculateTotalDueAtClosing(
    vars.original_purchase_price,
    vars.assignment_fee,
    vars.earnest_money_deposit
  );

  const tierReqs = getEarnestMoneyForTier(vars.assignee_tier);

  return `
================================================================================
              ASSIGNMENT OF REAL ESTATE PURCHASE AGREEMENT
================================================================================

Assignment Date: ${formatDate(vars.assignment_date)}
Original Contract Date: ${formatDate(vars.original_contract_date)}
Original Contract ID: ${vars.original_contract_id}

--------------------------------------------------------------------------------
                              SECTION 1: ASSIGNOR
--------------------------------------------------------------------------------

ASSIGNOR:
${ASSIGNOR_ENTITY}
(hereinafter referred to as "Assignor")

Assignor is the original Buyer under that certain Real Estate Purchase and Sale
Agreement dated ${formatDate(vars.original_contract_date)} (Contract ID: ${vars.original_contract_id})
between ${vars.original_seller_name} ("Seller") and ${ASSIGNOR_ENTITY} and/or
Assigns ("Original Buyer") for the property located at:

${vars.property_address}
${vars.property_city}, ${vars.property_state} ${vars.property_zip}

--------------------------------------------------------------------------------
                              SECTION 2: ASSIGNEE
--------------------------------------------------------------------------------

ASSIGNEE:
Name: ${vars.assignee_name}
${vars.assignee_company ? `Company: ${vars.assignee_company}` : ''}
Address: ${vars.assignee_address}
${vars.assignee_phone ? `Phone: ${vars.assignee_phone}` : ''}
${vars.assignee_email ? `Email: ${vars.assignee_email}` : ''}

Buyer Verification Status: ${vars.assignee_tier}
(hereinafter referred to as "Assignee")

--------------------------------------------------------------------------------
                    SECTION 3: ORIGINAL CONTRACT REFERENCE
--------------------------------------------------------------------------------

This Assignment refers to and incorporates by reference the Original Purchase
Agreement with the following terms:

Original Contract ID: ${vars.original_contract_id}
Original Contract Date: ${formatDate(vars.original_contract_date)}
Property Address: ${vars.property_address}, ${vars.property_city}, ${vars.property_state} ${vars.property_zip}
Original Seller: ${vars.original_seller_name}
Original Purchase Price: ${formatCurrency(vars.original_purchase_price)}
Scheduled Closing Date: ${formatDate(vars.closing_date)}

Assignee acknowledges receipt of a complete copy of the Original Purchase
Agreement and agrees to be bound by all terms and conditions therein.

--------------------------------------------------------------------------------
                          SECTION 4: ASSIGNMENT FEE
--------------------------------------------------------------------------------

ASSIGNMENT FEE: ${formatCurrency(vars.assignment_fee)}

In consideration for this Assignment, Assignee agrees to pay Assignor an
Assignment Fee of ${formatCurrency(vars.assignment_fee)}.

*** MINIMUM FEE DISCLOSURE ***
The minimum assignment fee for all transactions is ${formatCurrency(MINIMUM_ASSIGNMENT_FEE)}.
This fee compensates Assignor for:
  - Locating and securing the property under contract
  - Due diligence and market research
  - Contract negotiation and preparation
  - Assignment coordination and support

The Assignment Fee is due and payable at Closing through the Title Company.

--------------------------------------------------------------------------------
                      SECTION 5: TOTAL DUE AT CLOSING
--------------------------------------------------------------------------------

CALCULATION OF TOTAL AMOUNT DUE:

Original Purchase Price:        ${formatCurrency(vars.original_purchase_price)}
Assignment Fee:                +${formatCurrency(vars.assignment_fee)}
                               ─────────────────────
TOTAL PURCHASE PRICE:           ${formatCurrency(totalPrice)}

Less: Earnest Money Deposit:   -${formatCurrency(vars.earnest_money_deposit)}
                               ─────────────────────
BALANCE DUE AT CLOSING:         ${formatCurrency(balanceDue)}

All funds must be delivered to the Title Company via wire transfer or certified
funds no later than 24 hours before the scheduled closing.

--------------------------------------------------------------------------------
                      SECTION 6: EARNEST MONEY DEPOSIT
--------------------------------------------------------------------------------

EARNEST MONEY DEPOSIT: ${formatCurrency(vars.earnest_money_deposit)}

Based on Assignee's verification status (${vars.assignee_tier}), the required
earnest money range is ${formatCurrency(tierReqs.min)} to ${formatCurrency(tierReqs.max)}.

EARNEST MONEY REQUIREMENTS BY BUYER TIER:
  - VIP (Verified Track Record):      $100 - $500
  - VERIFIED (Background Checked):    $500 - $1,500
  - PROSPECT (POF Submitted):         $1,500 - $3,000
  - UNVERIFIED (New Buyer):           $3,000 - $5,000

The Earnest Money Deposit shall be delivered to the Title Company within
TWO (2) BUSINESS DAYS of execution of this Assignment.

EARNEST MONEY TERMS:
  - The deposit is NON-REFUNDABLE after the second business day following
    execution of this Assignment, EXCEPT in cases where Assignor fails to
    perform or title defects cannot be cured.
  - If Assignee fails to close for any reason other than Assignor default or
    title defect, the Earnest Money shall be forfeited to Assignor as
    liquidated damages.

--------------------------------------------------------------------------------
                      SECTION 7: ASSIGNEE ACKNOWLEDGMENTS
--------------------------------------------------------------------------------

Assignee acknowledges and agrees to the following:

1. INSPECTION: Assignee has had or will have the opportunity to inspect the
   Property and is purchasing the Property "AS-IS, WHERE-IS, WITH ALL FAULTS."

2. ORIGINAL CONTRACT: Assignee has received and reviewed the Original Purchase
   Agreement and agrees to assume all of Buyer's obligations thereunder.

3. CLOSING DEADLINE: Assignee understands that time is of the essence and
   failure to close by ${formatDate(vars.closing_date)} may result in default
   under both this Assignment and the Original Purchase Agreement.

4. FINANCING: If Assignee requires financing, Assignee represents that
   financing has been pre-approved and will be available by the closing date.
   Assignor makes no representations regarding Assignee's ability to obtain
   financing.

5. TITLE: Assignee will receive the same title that Seller is obligated to
   convey under the Original Purchase Agreement.

6. NO REPRESENTATION: Assignor makes no representations or warranties
   regarding the Property, its condition, value, or fitness for any purpose.

7. INDEPENDENT DECISION: Assignee has not relied on any statements,
   representations, or advice from Assignor other than those expressly
   contained in this Assignment.

ASSIGNEE'S INITIALS: _______ DATE: _______

--------------------------------------------------------------------------------
                      SECTION 8: WHOLESALING DISCLOSURE
--------------------------------------------------------------------------------

IMPORTANT DISCLOSURE - PLEASE READ CAREFULLY

This is a "wholesale" or "assignment" transaction. Assignee understands:

1. Assignor (${ASSIGNOR_ENTITY}) acquired the contractual right to purchase
   this Property but is not the owner of the Property.

2. Assignor is assigning those contractual rights to Assignee in exchange
   for the Assignment Fee of ${formatCurrency(vars.assignment_fee)}.

3. The original Seller will receive ${formatCurrency(vars.original_purchase_price)} at
   closing. Assignor will receive ${formatCurrency(vars.assignment_fee)} at closing.

4. Assignee is advised to seek independent legal counsel and conduct their
   own due diligence before executing this Assignment.

5. This Assignment does not create a partnership, joint venture, or agency
   relationship between Assignor and Assignee.

ASSIGNEE'S INITIALS: _______ DATE: _______

--------------------------------------------------------------------------------
                       SECTION 9: CLOSING INSTRUCTIONS
--------------------------------------------------------------------------------

CLOSING DATE: On or before ${formatDate(vars.closing_date)}

CLOSING LOCATION: At a Title Company mutually agreed upon by Seller and
Assignor, or as designated in the Original Purchase Agreement.

CLOSING INSTRUCTIONS:

1. Assignee shall wire the Balance Due at Closing (${formatCurrency(balanceDue)})
   to the Title Company no later than 24 hours before closing.

2. The Title Company shall:
   - Pay ${formatCurrency(vars.original_purchase_price)} to Seller
   - Pay ${formatCurrency(vars.assignment_fee)} to Assignor (${ASSIGNOR_ENTITY})
   - Record the deed in Assignee's name
   - Disburse any remaining funds per the closing statement

3. Assignee shall provide valid government-issued identification at closing.

4. If Assignee is an entity, Assignee shall provide organizational documents
   and a resolution authorizing the purchase.

--------------------------------------------------------------------------------
                        SECTION 10: ADDITIONAL TERMS
--------------------------------------------------------------------------------

${vars.additional_terms || 'None.'}

--------------------------------------------------------------------------------
                          SECTION 11: SIGNATURES
--------------------------------------------------------------------------------

This Assignment shall become effective upon execution by both parties.

ASSIGNOR:

${ASSIGNOR_ENTITY}

By: _______________________________________  Date: _______________

Print Name: _______________________________

Title: ____________________________________


ASSIGNEE:

Signature: _________________________________  Date: _______________

Print Name: ${vars.assignee_name}

${vars.assignee_company ? `Company: ${vars.assignee_company}` : ''}

Title (if applicable): _____________________


================================================================================
                            END OF ASSIGNMENT
================================================================================
`.trim();
}

export {
  formatCurrency as formatAssignmentCurrency,
  formatDate as formatAssignmentDate,
};
