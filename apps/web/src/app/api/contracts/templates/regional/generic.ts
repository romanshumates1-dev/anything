/**
 * Generic Regional Contract Addendum
 *
 * Base addendum for states without specific templates. Includes
 * standard disclosures such as Lead Paint (pre-1978) and common
 * property condition disclosures.
 */

export interface GenericAddendumVariables {
  property_address: string;
  contract_date: string;
  seller_name: string;
  buyer_name: string;
  property_state: string;
  property_county: string;

  // Property details
  property_year_built?: number;

  // Optional disclosures
  hoa?: boolean;
  well_water?: boolean;
  septic_system?: boolean;
  flood_zone?: string;
  environmental_concerns?: string;
}

/**
 * Standard disclosures for all states
 */
export const STANDARD_DISCLOSURES = {
  lead_paint_pre_1978: true,
  property_condition: true,
  as_is_acknowledgment: true,
  agency_disclosure: true,
};

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
 * Generate generic addendum
 */
export function generateGenericAddendum(vars: GenericAddendumVariables): string {
  const needsLeadPaint = vars.property_year_built && vars.property_year_built < 1978;

  return `
================================================================================
                  ADDENDUM TO REAL ESTATE PURCHASE AGREEMENT
                       (Standard Disclosures - ${vars.property_state})
================================================================================

This Addendum is attached to and made part of the Real Estate Purchase Agreement
dated ${formatDate(vars.contract_date)} between:

Seller: ${vars.seller_name}
Buyer: ${vars.buyer_name}

Property: ${vars.property_address}
State: ${vars.property_state}
County: ${vars.property_county}

--------------------------------------------------------------------------------
                    SECTION A: PROPERTY CONDITION DISCLOSURE
--------------------------------------------------------------------------------

                         SELLER'S DISCLOSURE STATEMENT

Seller makes the following representations regarding the Property to the best
of Seller's knowledge:

STRUCTURAL COMPONENTS:
[ ] No known defects
[ ] Known issues: ___________________________________________________

ROOF:
Approximate age: _______ years
[ ] No known leaks or damage
[ ] Known issues: ___________________________________________________

PLUMBING:
[ ] No known issues
[ ] Known issues: ___________________________________________________

ELECTRICAL:
[ ] No known issues
[ ] Known issues: ___________________________________________________

HEATING/COOLING (HVAC):
Type: _______________________  Approximate age: _______ years
[ ] No known issues
[ ] Known issues: ___________________________________________________

APPLIANCES (included in sale):
[ ] All in working order
[ ] Known issues: ___________________________________________________

PEST/TERMITE:
[ ] No known infestations
[ ] Previous treatments: ____________________________________________
[ ] Known issues: ___________________________________________________

ENVIRONMENTAL:
[ ] No known issues
[ ] Known concerns: _________________________________________________
${vars.environmental_concerns ? `\nAdditional environmental information:\n${vars.environmental_concerns}` : ''}

OTHER DISCLOSURES:
________________________________________________________________
________________________________________________________________

SELLER'S INITIALS: _______  BUYER'S INITIALS: _______

--------------------------------------------------------------------------------
              SECTION B: LEAD-BASED PAINT DISCLOSURE (FEDERAL)
--------------------------------------------------------------------------------

${needsLeadPaint ? `
               DISCLOSURE OF INFORMATION ON LEAD-BASED PAINT
                         AND/OR LEAD-BASED PAINT HAZARDS

This disclosure is required for residential properties built before 1978.

Property Address: ${vars.property_address}
Year Built: ${vars.property_year_built}

LEAD WARNING STATEMENT:

Housing built before 1978 may contain lead-based paint. Lead from paint, paint
chips, and dust can pose health hazards if not managed properly. Lead exposure
is especially harmful to young children and pregnant women. Before renting or
buying pre-1978 housing, federal law requires sellers to disclose known
information on lead-based paint and lead-based paint hazards.

SELLER'S DISCLOSURE (check applicable items):

[ ] (a) Presence of lead-based paint and/or lead-based paint hazards
    (check one):
    [ ] Seller has no knowledge of lead-based paint and/or lead-based paint
        hazards in the housing.
    [ ] Seller has knowledge of lead-based paint and/or lead-based paint
        hazards: _____________________________________________________

[ ] (b) Records and reports available to the seller (check one):
    [ ] Seller has no reports or records pertaining to lead-based paint
        and/or lead-based paint hazards in the housing.
    [ ] Seller has provided the buyer with all available records and reports:
        ____________________________________________________________

BUYER'S ACKNOWLEDGMENT (check all applicable):

[ ] (c) Buyer has received copies of all information listed above.

[ ] (d) Buyer has received the pamphlet "Protect Your Family From Lead in
        Your Home."

[ ] (e) Buyer has (check one):
    [ ] Received a 10-day opportunity (or mutually agreed upon period) to
        conduct a risk assessment or inspection for the presence of lead-based
        paint and/or lead-based paint hazards.
    [ ] Waived the opportunity to conduct a risk assessment or inspection.

AGENT'S ACKNOWLEDGMENT:

[ ] (f) Agent has informed the seller of the seller's obligations under
        42 U.S.C. 4852d and is aware of agent's responsibility to ensure
        compliance.

CERTIFICATION OF ACCURACY:

The following parties have reviewed the information above and certify, to the
best of their knowledge, that the information provided is true and accurate.

Seller: _________________________________ Date: _______________

Buyer: __________________________________ Date: _______________

Agent (if applicable): ___________________ Date: _______________
` : `
               LEAD-BASED PAINT DISCLOSURE

The Property was built in ${vars.property_year_built || '[year not provided]'}${vars.property_year_built && vars.property_year_built >= 1978 ? ', which is after 1978' : ''}.

${vars.property_year_built && vars.property_year_built >= 1978 ? 'The federal Lead-Based Paint Disclosure requirement does not apply to housing built after 1978.' : 'Property age not confirmed. If built before 1978, federal lead paint disclosure requirements apply.'}

BUYER'S INITIALS: _______
`}

--------------------------------------------------------------------------------
                        SECTION C: AS-IS ACKNOWLEDGMENT
--------------------------------------------------------------------------------

                     PROPERTY SOLD "AS-IS, WHERE-IS"

Buyer acknowledges and agrees:

1. The Property is being sold in its present "AS-IS, WHERE-IS" condition.

2. Except as specifically disclosed in this Addendum or the Purchase Agreement,
   Seller makes no representations or warranties regarding the condition of
   the Property.

3. Buyer has had or will have the opportunity to conduct inspections during
   the Inspection Period.

4. Buyer is relying on Buyer's own inspections and investigations, not on any
   representations by Seller (other than those expressly made herein).

5. Buyer accepts the Property with all faults, whether known or unknown.

6. This AS-IS provision shall survive closing.

BUYER'S INITIALS: _______

--------------------------------------------------------------------------------
                     SECTION D: ADDITIONAL DISCLOSURES
--------------------------------------------------------------------------------

${vars.hoa ? `
HOMEOWNERS ASSOCIATION:

The Property is subject to a homeowners association (HOA). Seller shall provide:
- Copy of CC&Rs (Covenants, Conditions, and Restrictions)
- Current HOA rules and regulations
- Most recent financial statements and budget
- Information on current assessments and any pending special assessments

Buyer has the right to review HOA documents during the Inspection Period.

BUYER'S INITIALS: _______
` : ''}

${vars.well_water ? `
WELL WATER DISCLOSURE:

The Property obtains water from a private well. Buyer is advised:
- Well water is not regulated by a public utility
- Water quality and quantity may vary
- Buyer should have the well inspected and water tested
- Well maintenance is the responsibility of the property owner
- Local regulations may apply to well usage and maintenance

BUYER'S INITIALS: _______
` : ''}

${vars.septic_system ? `
SEPTIC SYSTEM DISCLOSURE:

The Property uses a private septic system for wastewater treatment. Buyer is advised:
- Septic systems require regular maintenance and pumping
- Improper use can cause system failure
- Local regulations may require inspections for property transfers
- Replacement of septic systems can be costly
- Buyer should have the system inspected during the Inspection Period

BUYER'S INITIALS: _______
` : ''}

${vars.flood_zone ? `
FLOOD ZONE DISCLOSURE:

The Property is located in or near Flood Zone: ${vars.flood_zone}

Buyer is advised:
- Flood insurance may be required if there is a federally backed mortgage
- Flood insurance premiums can be substantial
- Past flooding does not guarantee future flooding (or lack thereof)
- Buyer should research flood history and risks for this area
- Contact FEMA or a flood insurance agent for premium estimates

BUYER'S INITIALS: _______
` : ''}

AGENCY DISCLOSURE:

The real estate agents involved in this transaction (if any) may represent:
[ ] Seller only
[ ] Buyer only
[ ] Both Seller and Buyer (dual agency - where permitted by state law)
[ ] Transaction broker (neutral - where permitted by state law)

Buyer and Seller should understand the nature of their representation before
proceeding with the transaction.

--------------------------------------------------------------------------------
                           SECTION E: STATE LAW NOTICE
--------------------------------------------------------------------------------

This transaction is subject to the laws of the State of ${vars.property_state}.

Buyer and Seller are advised to consult with an attorney licensed in
${vars.property_state} to understand their rights and obligations under state law.

Additional state-specific disclosures may be required. The absence of a
state-specific addendum does not relieve either party of their disclosure
obligations under applicable state law.

--------------------------------------------------------------------------------
                           SECTION F: SIGNATURES
--------------------------------------------------------------------------------

By signing below, the parties acknowledge receipt of all disclosures contained
herein and agree to be bound by the terms of this Addendum.

SELLER:

Signature: _________________________________  Date: _______________

Print Name: ${vars.seller_name}


BUYER:

Signature: _________________________________  Date: _______________

Print Name: ${vars.buyer_name}


================================================================================
                           END OF ADDENDUM
================================================================================
`.trim();
}

/**
 * Get list of required generic disclosures
 */
export function getGenericRequiredDisclosures(
  propertyYearBuilt?: number,
  options?: { hoa?: boolean; wellWater?: boolean; septicSystem?: boolean; floodZone?: string }
): string[] {
  const disclosures = [
    'Seller Property Condition Disclosure',
    'As-Is Property Acknowledgment',
    'Agency Disclosure',
  ];

  if (propertyYearBuilt && propertyYearBuilt < 1978) {
    disclosures.push('Lead-Based Paint Disclosure (Federal - 42 U.S.C. 4852d)');
  }

  if (options?.hoa) {
    disclosures.push('Homeowners Association Disclosure');
  }

  if (options?.wellWater) {
    disclosures.push('Well Water Disclosure');
  }

  if (options?.septicSystem) {
    disclosures.push('Septic System Disclosure');
  }

  if (options?.floodZone) {
    disclosures.push('Flood Zone Disclosure');
  }

  return disclosures;
}

/**
 * List of states with specific templates
 */
export const STATES_WITH_SPECIFIC_TEMPLATES = ['TX', 'FL', 'CA'];

/**
 * Check if state has a specific template
 */
export function hasSpecificTemplate(stateCode: string): boolean {
  return STATES_WITH_SPECIFIC_TEMPLATES.includes(stateCode.toUpperCase());
}

export { formatDate as formatGenericDate };
