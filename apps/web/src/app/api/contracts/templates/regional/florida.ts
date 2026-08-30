/**
 * Florida Regional Contract Addendum
 *
 * Florida-specific addendum including the As-Is Rider, Radon Gas Disclosure,
 * and Property Tax disclosure requirements.
 */

export interface FloridaAddendumVariables {
  property_address: string;
  contract_date: string;
  seller_name: string;
  buyer_name: string;
  purchase_price: number;

  // Florida-specific
  property_year_built?: number;
  property_county: string;
  condominium?: boolean;
  hoa?: boolean;
  radon_test_conducted?: boolean;
  radon_test_results?: string;
  flood_zone?: string;
}

export const FLORIDA_STATE_CODE = 'FL';

/**
 * Florida requires specific statutory disclosures
 */
export const FLORIDA_REQUIRED_DISCLOSURES = {
  radon_gas: true,
  property_tax: true,
  as_is_rider: true,
  lead_paint_pre_1978: true,
  coastal_construction: 'if applicable',
  condominium_rider: 'if applicable',
  homeowners_association: 'if applicable',
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
 * Generate Florida-specific addendum
 */
export function generateFloridaAddendum(vars: FloridaAddendumVariables): string {
  const needsLeadPaint = vars.property_year_built && vars.property_year_built < 1978;

  return `
================================================================================
                   FLORIDA ADDENDUM TO PURCHASE AGREEMENT
================================================================================

This Addendum is attached to and made part of the Real Estate Purchase Agreement
dated ${formatDate(vars.contract_date)} between:

Seller: ${vars.seller_name}
Buyer: ${vars.buyer_name}

Property: ${vars.property_address}
County: ${vars.property_county}

--------------------------------------------------------------------------------
                        SECTION A: AS-IS RIDER
--------------------------------------------------------------------------------

                    FLORIDA "AS-IS" RESIDENTIAL CONTRACT

This is an "AS-IS" contract. Except as otherwise provided in this contract,
Buyer accepts the Property in its present physical condition, subject to
ordinary wear and tear through the date of closing.

BUYER ACKNOWLEDGES AND AGREES:

1. Buyer has the right to conduct inspections, tests, and investigations of
   the Property during the Inspection Period set forth in the main contract.

2. Buyer accepts the Property "AS-IS" and waives any claims against Seller
   for repairs or defects discovered after closing.

3. Seller makes no warranties, express or implied, as to:
   (a) The physical condition of the Property
   (b) The condition of the roof, foundation, walls, plumbing, electrical,
       HVAC, or any other systems
   (c) The presence or absence of termites, wood-destroying organisms, mold,
       or environmental hazards
   (d) The accuracy of square footage or lot dimensions
   (e) The zoning or land use regulations affecting the Property
   (f) The existence of permits for improvements or additions

4. Buyer has been advised to obtain independent inspections of all aspects
   of the Property and to rely solely on such inspections.

5. This AS-IS provision shall survive closing.

SELLER'S DISCLOSURE NOTICE:

Notwithstanding the AS-IS nature of this sale, Seller is required under
Florida law to disclose known material facts affecting the value of the
Property. Seller represents:

[ ] Seller knows of no facts materially affecting the value of the Property
    that are not readily observable.

[ ] Seller discloses the following known material facts:
    ________________________________________________________________
    ________________________________________________________________

BUYER'S INITIALS: _______  SELLER'S INITIALS: _______

--------------------------------------------------------------------------------
                      SECTION B: RADON GAS DISCLOSURE
--------------------------------------------------------------------------------

                    FLORIDA RADON GAS DISCLOSURE
                 (Required by Section 404.056, Florida Statutes)

RADON GAS: Radon is a naturally occurring radioactive gas that, when it has
accumulated in a building in sufficient quantities, may present health risks
to persons who are exposed to it over time. Levels of radon that exceed
federal and state guidelines have been found in buildings in Florida.
Additional information regarding radon and radon testing may be obtained
from your county health department.

RADON TESTING STATUS:

[ ${vars.radon_test_conducted ? 'X' : ' '} ] A radon test HAS been conducted on the Property.
${vars.radon_test_results ? `    Results: ${vars.radon_test_results}` : ''}

[ ${!vars.radon_test_conducted ? 'X' : ' '} ] A radon test HAS NOT been conducted on the Property.

Buyer has the right to conduct radon testing during the Inspection Period.
If radon is found at levels exceeding 4 pCi/L (picocuries per liter), Buyer
may request that Seller remediate the radon condition. Seller is not
obligated to perform such remediation under this AS-IS contract.

BUYER'S INITIALS: _______

--------------------------------------------------------------------------------
                     SECTION C: PROPERTY TAX DISCLOSURE
--------------------------------------------------------------------------------

                 FLORIDA PROPERTY TAX DISCLOSURE SUMMARY
              (Required by Section 689.261, Florida Statutes)

NOTICE TO BUYER:

The assessed value of this Property for property tax purposes may increase
after the sale. The taxable value of the Property and the resulting property
taxes are NOT capped or limited by the sale price.

IMPORTANT INFORMATION:

1. PROPERTY TAX BASIS: The assessed value of the Property may be significantly
   lower than the sale price due to Florida's "Save Our Homes" cap on annual
   assessment increases. This cap (3% per year or CPI, whichever is lower)
   is removed upon sale.

2. ASSESSMENT AFTER SALE: After the sale, the Property will be reassessed
   at "just value" (market value), which may be substantially higher than
   the current assessed value.

3. TAX IMPACT: As a result, property taxes for the year following the sale
   may be significantly HIGHER than the current year's taxes.

4. EXEMPTIONS: If the Property currently has a homestead exemption, that
   exemption will be removed upon sale. Buyer may apply for a new homestead
   exemption if the Property will be Buyer's primary residence.

ESTIMATED TAX IMPACT:

Purchase Price:                         ${formatCurrency(vars.purchase_price)}
Current Assessed Value:                 [To be verified by Buyer]
Potential New Assessed Value:           [May equal or exceed purchase price]

BUYER SHOULD CONTACT THE ${vars.property_county.toUpperCase()} COUNTY PROPERTY
APPRAISER'S OFFICE FOR ACCURATE TAX PROJECTIONS.

BUYER'S INITIALS: _______

--------------------------------------------------------------------------------
                        SECTION D: FLOOD DISCLOSURE
--------------------------------------------------------------------------------

${vars.flood_zone ? `
FLOOD ZONE DESIGNATION:

The Property is located in Flood Zone: ${vars.flood_zone}

If the Property is located in a Special Flood Hazard Area (Zones A, AE, AH,
AO, AR, A99, V, VE, or V1-30):

1. Federal law requires flood insurance for properties in these zones if
   there is a federally backed mortgage.

2. Flood insurance premiums can be substantial and may increase significantly.

3. Building restrictions and requirements may apply to improvements, repairs,
   or reconstruction of the Property.

4. Buyer should contact FEMA or a flood insurance agent for current premium
   estimates and coverage requirements.
` : `
FLOOD ZONE DISCLOSURE:

Buyer should verify the flood zone designation of the Property with FEMA
or the ${vars.property_county} County Building Department. Florida properties,
especially those near the coast or waterways, may be subject to flood risks.
`}

BUYER'S INITIALS: _______

--------------------------------------------------------------------------------
                  SECTION E: ADDITIONAL FLORIDA DISCLOSURES
--------------------------------------------------------------------------------

${vars.condominium ? `
CONDOMINIUM DISCLOSURE:

The Property is a condominium unit. Seller shall deliver to Buyer the following
within 3 days of the effective date of this contract:

1. Declaration of Condominium and all amendments
2. Articles of Incorporation and Bylaws of the Association
3. Rules of the Association
4. Most recent year-end financial report and current year budget
5. Evidence of required reserves (or waiver of reserves)
6. Statement of assessments

Buyer has 3 days after receipt of condominium documents to cancel this
contract and receive a refund of the earnest money deposit.
` : ''}

${vars.hoa ? `
HOMEOWNERS ASSOCIATION DISCLOSURE:

The Property is subject to a mandatory homeowners association. Seller shall
deliver to Buyer the following within 3 days:

1. Governing documents (covenants, restrictions, articles, bylaws, rules)
2. Current financial information and assessments
3. Any pending or anticipated special assessments

Buyer has 3 days after receipt of HOA documents to cancel this contract.
` : ''}

${needsLeadPaint ? `
LEAD-BASED PAINT DISCLOSURE (Pre-1978 Property):

The Property was built in ${vars.property_year_built}, before 1978. Federal
law requires disclosure of known lead-based paint hazards.

Seller discloses:
[ ] Seller has no knowledge of lead-based paint and/or hazards.
[ ] Seller has knowledge of the following: ___________________________

Buyer has received the EPA pamphlet "Protect Your Family From Lead in Your Home."

Seller's Initials: _______ Buyer's Initials: _______
` : ''}

MOLD DISCLOSURE:

Mold is naturally present in the Florida environment due to humidity. Mold
may cause health issues and property damage. Buyer is advised to have the
Property inspected for mold by a qualified professional.

SINKHOLE DISCLOSURE:

Sinkholes have been found in various areas of Florida. Buyer should research
the sinkhole history of the area and consider obtaining a geological inspection.

--------------------------------------------------------------------------------
                           SECTION F: SIGNATURES
--------------------------------------------------------------------------------

By signing below, the parties acknowledge receipt of all disclosures contained
herein and agree to be bound by the terms of this Florida Addendum.

SELLER:

Signature: _________________________________  Date: _______________

Print Name: ${vars.seller_name}


BUYER:

Signature: _________________________________  Date: _______________

Print Name: ${vars.buyer_name}


================================================================================
                        END OF FLORIDA ADDENDUM
================================================================================
`.trim();
}

/**
 * Get list of required Florida disclosures
 */
export function getFloridaRequiredDisclosures(
  propertyYearBuilt?: number,
  isCondominium?: boolean,
  hasHOA?: boolean
): string[] {
  const disclosures = [
    'Florida As-Is Rider',
    'Radon Gas Disclosure (Section 404.056 F.S.)',
    'Property Tax Disclosure (Section 689.261 F.S.)',
    'Flood Zone Disclosure',
    'Mold Disclosure',
    'Sinkhole Disclosure',
  ];

  if (propertyYearBuilt && propertyYearBuilt < 1978) {
    disclosures.push('Lead-Based Paint Disclosure (Federal)');
  }

  if (isCondominium) {
    disclosures.push('Condominium Disclosure (Chapter 718 F.S.)');
  }

  if (hasHOA) {
    disclosures.push('HOA Disclosure (Chapter 720 F.S.)');
  }

  return disclosures;
}

export { formatCurrency as formatFloridaCurrency, formatDate as formatFloridaDate };
