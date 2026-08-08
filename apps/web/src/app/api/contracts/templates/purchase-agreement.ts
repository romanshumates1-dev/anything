/**
 * Purchase Agreement Template (Cameron Oliveira Style)
 *
 * A comprehensive wholesaler-friendly purchase agreement designed for
 * real estate acquisitions with assignment rights. This template includes
 * all required disclosures and protections for both parties.
 */

export interface PurchaseAgreementVariables {
  // Parties
  seller_name: string;
  seller_address: string;
  seller_phone?: string;
  seller_email?: string;

  // Property
  property_address: string;
  property_city: string;
  property_state: string;
  property_zip: string;
  property_county: string;
  property_legal_description?: string;
  property_parcel_id?: string;

  // Terms
  purchase_price: number;
  earnest_money: number;
  closing_date: string;
  inspection_days: number; // min 7, default 14-21
  attorney_mod_days: number; // default 5

  // Dates
  contract_date: string;
  earnest_money_due_date?: string; // calculated: 3 business days from contract_date

  // Regional
  regional_disclosures?: string;

  // Additional
  additional_terms?: string;
}

export const PURCHASE_AGREEMENT_DEFAULTS = {
  inspection_days: 14,
  attorney_mod_days: 5,
  earnest_money: 1000,
};

export const MIN_INSPECTION_DAYS = 7;
export const MAX_INSPECTION_DAYS = 45;
export const BUYER_ENTITY = 'DealSwift Automation LLC and/or Assigns';

/**
 * Validate purchase agreement variables
 */
export function validatePurchaseAgreementVariables(
  vars: Partial<PurchaseAgreementVariables>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Required fields
  if (!vars.seller_name?.trim()) errors.push('seller_name is required');
  if (!vars.seller_address?.trim()) errors.push('seller_address is required');
  if (!vars.property_address?.trim()) errors.push('property_address is required');
  if (!vars.property_city?.trim()) errors.push('property_city is required');
  if (!vars.property_state?.trim()) errors.push('property_state is required');
  if (!vars.property_zip?.trim()) errors.push('property_zip is required');
  if (!vars.property_county?.trim()) errors.push('property_county is required');

  // Numeric validations
  if (typeof vars.purchase_price !== 'number' || vars.purchase_price <= 0) {
    errors.push('purchase_price must be a positive number');
  }
  if (typeof vars.earnest_money !== 'number' || vars.earnest_money < 0) {
    errors.push('earnest_money must be a non-negative number');
  }

  // Inspection days validation
  if (vars.inspection_days !== undefined) {
    if (vars.inspection_days < MIN_INSPECTION_DAYS) {
      errors.push(`inspection_days must be at least ${MIN_INSPECTION_DAYS}`);
    }
    if (vars.inspection_days > MAX_INSPECTION_DAYS) {
      errors.push(`inspection_days must not exceed ${MAX_INSPECTION_DAYS}`);
    }
  }

  // Date validations
  if (!vars.contract_date) errors.push('contract_date is required');
  if (!vars.closing_date) errors.push('closing_date is required');

  return { valid: errors.length === 0, errors };
}

/**
 * Calculate earnest money due date (3 business days from contract date)
 */
export function calculateEarnestMoneyDueDate(contractDate: string): string {
  const date = new Date(contractDate);
  let businessDays = 0;
  while (businessDays < 3) {
    date.setDate(date.getDate() + 1);
    const dayOfWeek = date.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      businessDays++;
    }
  }
  return date.toISOString().split('T')[0];
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
 * Generate the purchase agreement contract
 */
export function generatePurchaseAgreement(
  vars: PurchaseAgreementVariables
): string {
  const validation = validatePurchaseAgreementVariables(vars);
  if (!validation.valid) {
    throw new Error(`Invalid contract variables: ${validation.errors.join(', ')}`);
  }

  const earnestMoneyDueDate = vars.earnest_money_due_date ||
    calculateEarnestMoneyDueDate(vars.contract_date);
  const inspectionDays = vars.inspection_days || PURCHASE_AGREEMENT_DEFAULTS.inspection_days;
  const attorneyModDays = vars.attorney_mod_days || PURCHASE_AGREEMENT_DEFAULTS.attorney_mod_days;

  return `
================================================================================
                    REAL ESTATE PURCHASE AND SALE AGREEMENT
================================================================================

Contract Date: ${formatDate(vars.contract_date)}
Property Address: ${vars.property_address}, ${vars.property_city}, ${vars.property_state} ${vars.property_zip}

--------------------------------------------------------------------------------
                              SECTION 1: PARTIES
--------------------------------------------------------------------------------

SELLER:
Name: ${vars.seller_name}
Address: ${vars.seller_address}
${vars.seller_phone ? `Phone: ${vars.seller_phone}` : ''}
${vars.seller_email ? `Email: ${vars.seller_email}` : ''}

BUYER:
${BUYER_ENTITY}
(hereinafter referred to as "Buyer")

--------------------------------------------------------------------------------
                         SECTION 2: PROPERTY DETAILS
--------------------------------------------------------------------------------

Property Address: ${vars.property_address}
City: ${vars.property_city}
State: ${vars.property_state}
ZIP Code: ${vars.property_zip}
County: ${vars.property_county}
${vars.property_parcel_id ? `Parcel ID / Tax ID: ${vars.property_parcel_id}` : ''}
${vars.property_legal_description ? `\nLegal Description:\n${vars.property_legal_description}` : ''}

Together with all improvements, fixtures, and appurtenances thereto
(collectively, the "Property").

--------------------------------------------------------------------------------
                      SECTION 3: PURCHASE PRICE AND TERMS
--------------------------------------------------------------------------------

PURCHASE PRICE: ${formatCurrency(vars.purchase_price)}
(${numberToWords(vars.purchase_price)} Dollars)

EARNEST MONEY DEPOSIT: ${formatCurrency(vars.earnest_money)}

The Earnest Money Deposit shall be delivered to the designated Title Company
or Escrow Agent within THREE (3) BUSINESS DAYS of the Effective Date of this
Agreement (due by ${formatDate(earnestMoneyDueDate)}).

The Earnest Money shall be held in escrow and applied toward the Purchase Price
at Closing, or refunded to Buyer per the terms of this Agreement.

BALANCE DUE AT CLOSING: ${formatCurrency(vars.purchase_price - vars.earnest_money)}

--------------------------------------------------------------------------------
                            SECTION 4: CLOSING
--------------------------------------------------------------------------------

CLOSING DATE: On or before ${formatDate(vars.closing_date)}

Closing shall take place at a Title Company mutually agreed upon by both parties.
Seller agrees to convey marketable title by General Warranty Deed, free and clear
of all liens, encumbrances, and defects, except for:
  - Current year real property taxes (prorated at closing)
  - Existing easements and restrictions of record
  - Zoning ordinances

Seller shall pay for:
  - Document preparation fees
  - Documentary stamp taxes on the deed (where applicable)
  - Pro-rated property taxes through closing date
  - Any outstanding liens or encumbrances

Buyer shall pay for:
  - Title search and title insurance premium
  - Recording fees for the deed
  - Any closing costs associated with Buyer's financing (if applicable)

--------------------------------------------------------------------------------
                        SECTION 5: INSPECTION PERIOD
--------------------------------------------------------------------------------

INSPECTION PERIOD: ${inspectionDays} DAYS from the Effective Date

Buyer shall have ${inspectionDays} days from the Effective Date of this Agreement
(the "Inspection Period") to conduct, at Buyer's expense, any and all inspections,
tests, surveys, and investigations of the Property that Buyer deems necessary or
desirable, including but not limited to:

  - Physical inspection of the Property
  - Environmental assessments
  - Survey
  - Title examination
  - Feasibility studies
  - Review of any HOA documents (if applicable)

During the Inspection Period, Buyer may terminate this Agreement for ANY reason
or NO reason by providing written notice to Seller. Upon such termination, the
Earnest Money shall be immediately refunded to Buyer.

If Buyer does not terminate within the Inspection Period, the Earnest Money shall
become NON-REFUNDABLE, except in cases of Seller default or title defects that
Seller fails to cure.

--------------------------------------------------------------------------------
                    SECTION 6: ATTORNEY MODIFICATION PERIOD
--------------------------------------------------------------------------------

ATTORNEY MODIFICATION PERIOD: ${attorneyModDays} DAYS from the Effective Date

Each party shall have ${attorneyModDays} business days from the Effective Date to
have this Agreement reviewed by their respective attorneys. Either party may
propose modifications to this Agreement during this period. If the parties cannot
agree on modifications, either party may terminate this Agreement by written
notice, and the Earnest Money shall be refunded to Buyer.

--------------------------------------------------------------------------------
                         SECTION 7: AS-IS CONDITION
--------------------------------------------------------------------------------

BUYER ACCEPTS THE PROPERTY "AS-IS, WHERE-IS, WITH ALL FAULTS."

Seller makes no representations or warranties regarding the condition of the
Property, including but not limited to:

  - Structural integrity
  - Roof condition
  - Plumbing, electrical, or HVAC systems
  - Foundation
  - Environmental conditions
  - Pest infestation
  - Code compliance
  - Fitness for any particular purpose

Buyer acknowledges that Buyer has had or will have the opportunity to conduct
inspections during the Inspection Period and is relying solely on Buyer's own
inspections and investigations.

--------------------------------------------------------------------------------
                      SECTION 8: WHOLESALING DISCLOSURE
--------------------------------------------------------------------------------

IMPORTANT DISCLOSURE - PLEASE READ CAREFULLY

Buyer is a real estate investor and may assign this Agreement to another party
before closing. This is known as "wholesaling" or "contract assignment."

Seller understands and acknowledges:

1. Buyer (${BUYER_ENTITY}) intends to market this Agreement to other
   investors and may assign this contract before closing.

2. Buyer may profit from such assignment without investing any additional funds
   in the Property.

3. The ultimate purchaser may pay more than the Purchase Price stated herein.

4. Seller has been advised to seek independent legal counsel before signing
   this Agreement.

5. Seller is selling the Property at the agreed-upon Purchase Price regardless
   of any assignment fee or profit earned by Buyer.

SELLER'S INITIALS: _______ DATE: _______

--------------------------------------------------------------------------------
                       SECTION 9: ASSIGNMENT CLAUSE
--------------------------------------------------------------------------------

This Agreement IS FREELY ASSIGNABLE by Buyer without the consent of Seller.

Buyer may assign all or any portion of Buyer's rights and obligations under
this Agreement to any person or entity. Upon such assignment:

  - Buyer shall provide written notice to Seller of the assignment
  - The assignee shall assume all of Buyer's obligations hereunder
  - Buyer shall remain liable for the Earnest Money unless released by Seller

The assignment of this Agreement shall not release Buyer from liability unless
the assignment is accepted by Seller in writing.

--------------------------------------------------------------------------------
                            SECTION 10: DEFAULT
--------------------------------------------------------------------------------

SELLER DEFAULT:
If Seller fails to perform any obligation under this Agreement, Buyer may:
  (a) Seek specific performance; or
  (b) Terminate this Agreement and receive a full refund of the Earnest Money
      plus reimbursement of actual documented expenses up to $1,000.

BUYER DEFAULT:
If Buyer fails to close after the Inspection Period has expired (and Buyer has
not terminated), and such failure is not due to Seller's default or title
defects, Seller's sole remedy shall be to retain the Earnest Money as
liquidated damages. Seller waives any right to seek specific performance or
additional damages against Buyer.

--------------------------------------------------------------------------------
                        SECTION 11: ADDITIONAL TERMS
--------------------------------------------------------------------------------

${vars.additional_terms || 'None.'}

--------------------------------------------------------------------------------
                       SECTION 12: REGIONAL DISCLOSURES
--------------------------------------------------------------------------------

${vars.regional_disclosures || 'See attached state-specific addendum for required disclosures.'}

--------------------------------------------------------------------------------
                          SECTION 13: SIGNATURES
--------------------------------------------------------------------------------

This Agreement shall become effective upon execution by both parties (the
"Effective Date").

SELLER:

Signature: _________________________________  Date: _______________

Print Name: ${vars.seller_name}


BUYER:

${BUYER_ENTITY}

By: _______________________________________  Date: _______________

Print Name: _______________________________

Title: ____________________________________


================================================================================
                              END OF AGREEMENT
================================================================================
`.trim();
}

/**
 * Convert number to words for contract display
 * Fixed: use separate 'remaining' variable to avoid shadowing parameter
 */
function numberToWords(num: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  if (num === 0) return 'Zero';
  if (num < 0) return 'Negative ' + numberToWords(Math.abs(num));

  let remaining = Math.floor(num);
  let words = '';

  if (remaining >= 1000000) {
    words += numberToWords(Math.floor(remaining / 1000000)) + ' Million ';
    remaining = remaining % 1000000;
  }

  if (remaining >= 1000) {
    words += numberToWords(Math.floor(remaining / 1000)) + ' Thousand ';
    remaining = remaining % 1000;
  }

  if (remaining >= 100) {
    words += ones[Math.floor(remaining / 100)] + ' Hundred ';
    remaining = remaining % 100;
  }

  if (remaining >= 20) {
    words += tens[Math.floor(remaining / 10)] + ' ';
    remaining = remaining % 10;
  } else if (remaining >= 10) {
    words += teens[remaining - 10] + ' ';
    remaining = 0;
  }

  if (remaining > 0) {
    words += ones[remaining] + ' ';
  }

  return words.trim();
}

export { numberToWords };
