/**
 * Texas Regional Contract Addendum
 *
 * TREC-style (Texas Real Estate Commission) addendum with required
 * Texas-specific disclosures and earnest money language.
 */

export interface TexasAddendumVariables {
  property_address: string;
  contract_date: string;
  seller_name: string;
  buyer_name: string;
  earnest_money: number;
  title_company_name?: string;
  title_company_address?: string;

  // Texas-specific
  survey_required?: boolean;
  hoa_addendum_attached?: boolean;
  property_year_built?: number;
  seller_disclosure_attached?: boolean;
}

export const TEXAS_STATE_CODE = 'TX';

/**
 * Texas requires specific earnest money handling language
 */
export const TEXAS_EARNEST_MONEY_REQUIREMENTS = {
  escrow_agent_requirement: true,
  interest_bearing_option: true,
  release_requirements: 'written agreement of both parties or court order',
};

/**
 * Texas property condition disclosure requirements
 */
export const TEXAS_DISCLOSURE_REQUIREMENTS = {
  seller_disclosure: true,
  lead_paint_pre_1978: true,
  mold_addendum: false, // optional but recommended
  hoa_addendum_if_applicable: true,
  survey_optional: true,
};

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
 * Generate Texas-specific addendum
 */
export function generateTexasAddendum(vars: TexasAddendumVariables): string {
  const needsLeadPaint = vars.property_year_built && vars.property_year_built < 1978;

  return `
================================================================================
                    TEXAS ADDENDUM TO PURCHASE AGREEMENT
                         (TREC-Style Provisions)
================================================================================

This Addendum is attached to and made part of the Real Estate Purchase Agreement
dated ${formatDate(vars.contract_date)} between:

Seller: ${vars.seller_name}
Buyer: ${vars.buyer_name}

Property: ${vars.property_address}

--------------------------------------------------------------------------------
                      SECTION A: EARNEST MONEY PROVISIONS
--------------------------------------------------------------------------------

EARNEST MONEY: ${formatCurrency(vars.earnest_money)}

${vars.title_company_name ? `Title Company: ${vars.title_company_name}` : ''}
${vars.title_company_address ? `Address: ${vars.title_company_address}` : ''}

The Earnest Money shall be deposited with the Title Company (Escrow Agent)
within the time specified in the Purchase Agreement. The Escrow Agent is
authorized and directed to hold and disburse the Earnest Money in accordance
with the terms of this contract.

ESCROW AGENT PROVISIONS (TREC LANGUAGE):

1. The Earnest Money must be held by the Escrow Agent until:
   (a) Closing and funding of the sale; or
   (b) A written release signed by both Buyer and Seller; or
   (c) A court order disposing of the Earnest Money.

2. In the event of a dispute over the Earnest Money, the Escrow Agent shall:
   (a) Continue to hold the funds until receiving a written agreement signed
       by both parties directing disbursement; or
   (b) Interplead the funds into the registry of a court of competent
       jurisdiction in the county where the Property is located.

3. The Escrow Agent is not liable for any loss of Earnest Money due to the
   failure of a depository institution unless the Escrow Agent acted with
   willful misconduct or gross negligence.

4. At the option of the Escrow Agent, the Earnest Money may be placed in an
   interest-bearing account. Any interest earned shall be distributed as
   part of the Earnest Money disbursement.

--------------------------------------------------------------------------------
                    SECTION B: PROPERTY CONDITION DISCLOSURE
--------------------------------------------------------------------------------

TEXAS SELLER'S DISCLOSURE NOTICE:

Under Texas Property Code Section 5.008, Seller is required to deliver a
Seller's Disclosure Notice to Buyer on or before the effective date of this
contract.

[ ${vars.seller_disclosure_attached ? 'X' : ' '} ] Seller's Disclosure Notice is attached.
[ ${!vars.seller_disclosure_attached ? 'X' : ' '} ] Seller's Disclosure Notice to be delivered within 3 days.

IMPORTANT: The Seller's Disclosure Notice is a disclosure of the seller's
knowledge of the condition of the property and is not a substitute for any
inspections or warranties the purchaser may wish to obtain.

PROPERTY CONDITION:

Buyer accepts the Property in its present condition and AS-IS, WHERE-IS, and
WITH ALL FAULTS. Seller has made no representations or warranties regarding
the condition of the Property except as disclosed in the Seller's Disclosure
Notice.

Notwithstanding the AS-IS provision:

1. Seller shall deliver the Property in the same condition as of the date of
   this contract, ordinary wear and tear excepted.

2. Seller shall maintain existing landscaping, pools, and all systems in
   working order through closing.

3. If the Property is damaged or destroyed by fire or other casualty before
   closing, Buyer may terminate this contract and receive a refund of the
   Earnest Money.

--------------------------------------------------------------------------------
                       SECTION C: TITLE PROVISIONS
--------------------------------------------------------------------------------

TITLE POLICY:

A title insurance policy in the amount of the Purchase Price shall be furnished
to Buyer at Seller's expense, unless otherwise agreed.

SURVEY:

[ ${vars.survey_required ? 'X' : ' '} ] A new survey is required at Buyer's expense.
[ ${!vars.survey_required ? 'X' : ' '} ] An existing survey acceptable to the Title Company is available.

If a new survey is required, Buyer shall have any objections to the survey
delivered to Seller within the time allowed for title objections.

TITLE EXCEPTIONS:

The title policy may contain exceptions for:
1. Restrictive covenants common to the platted subdivision
2. Standing improvements and fences at boundary lines
3. Rights of parties in possession under unrecorded leases
4. Shortages in area, roadways, and rights-of-way

--------------------------------------------------------------------------------
                      SECTION D: TEXAS-SPECIFIC NOTICES
--------------------------------------------------------------------------------

NOTICE REGARDING MOLD:

Mold is naturally occurring and may cause health risks or damage to property.
If Buyer is concerned about the presence of mold, Buyer should have the
Property inspected by a qualified mold inspector.

NOTICE REGARDING SUBSURFACE RIGHTS:

If mineral interests, including oil and gas rights, are not being conveyed
as part of this transaction, the Seller or any subsequent owner of such
rights may explore, drill, and produce oil, gas, or other minerals from the
Property, which may affect Buyer's use of the Property.

NOTICE OF TAXING UNITS:

Buyer should contact the Texas Comptroller of Public Accounts or the local
appraisal district to determine if there are any outstanding property tax
liens or pending tax rate changes.

${needsLeadPaint ? `
LEAD-BASED PAINT DISCLOSURE (Pre-1978 Property):

The Property was built in ${vars.property_year_built}, before 1978. Federal
law requires that Seller disclose the presence of known lead-based paint
and lead-based paint hazards in the Property. Buyer has received the EPA
pamphlet "Protect Your Family From Lead in Your Home."

[ ] Seller has no knowledge of lead-based paint and/or lead-based paint
    hazards in the Property.

[ ] Seller has knowledge of the following lead-based paint and/or lead-based
    paint hazards: _____________________________________________

Seller's Initials: _______ Buyer's Initials: _______
` : ''}

--------------------------------------------------------------------------------
                  SECTION E: HOA/PROPERTY OWNERS ASSOCIATION
--------------------------------------------------------------------------------

[ ${vars.hoa_addendum_attached ? 'X' : ' '} ] The Property IS subject to a mandatory HOA/Property Owners Association.
    The HOA Addendum is attached.

[ ${!vars.hoa_addendum_attached ? 'X' : ' '} ] The Property IS NOT subject to a mandatory HOA/Property Owners Association.

If applicable: Seller shall deliver to Buyer resale certificates, bylaws,
rules, and financial information from the HOA within 3 days of the effective
date of this contract.

--------------------------------------------------------------------------------
                           SECTION F: SIGNATURES
--------------------------------------------------------------------------------

By signing below, the parties agree to be bound by the terms of this Texas
Addendum in addition to the terms of the Purchase Agreement.

SELLER:

Signature: _________________________________  Date: _______________

Print Name: ${vars.seller_name}


BUYER:

Signature: _________________________________  Date: _______________

Print Name: ${vars.buyer_name}


================================================================================
                         END OF TEXAS ADDENDUM
================================================================================
`.trim();
}

/**
 * Get list of required Texas disclosures
 */
export function getTexasRequiredDisclosures(propertyYearBuilt?: number): string[] {
  const disclosures = [
    "Texas Seller's Disclosure Notice (Section 5.008 Texas Property Code)",
    'Earnest Money Escrow Provisions',
    'Property Condition Acceptance',
  ];

  if (propertyYearBuilt && propertyYearBuilt < 1978) {
    disclosures.push('Lead-Based Paint Disclosure (Federal)');
  }

  return disclosures;
}

export { formatCurrency as formatTexasCurrency, formatDate as formatTexasDate };
