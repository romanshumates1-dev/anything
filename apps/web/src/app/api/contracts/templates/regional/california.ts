/**
 * California Regional Contract Addendum
 *
 * California-specific addendum including Transfer Disclosure Statement (TDS),
 * Natural Hazard Disclosure (NHD), and Megan's Law disclosure requirements.
 */

export interface CaliforniaAddendumVariables {
  property_address: string;
  contract_date: string;
  seller_name: string;
  buyer_name: string;
  purchase_price: number;

  // California-specific
  property_year_built?: number;
  property_county: string;
  property_city: string;
  special_flood_hazard_area?: boolean;
  earthquake_fault_zone?: boolean;
  fire_hazard_zone?: boolean;
  nhd_report_attached?: boolean;
  tds_attached?: boolean;
}

export const CALIFORNIA_STATE_CODE = 'CA';

/**
 * California requires extensive statutory disclosures
 */
export const CALIFORNIA_REQUIRED_DISCLOSURES = {
  transfer_disclosure_statement: true, // Civil Code 1102
  natural_hazard_disclosure: true, // Civil Code 1103
  megans_law: true, // Civil Code 2079.10a
  lead_paint_pre_1978: true,
  smoke_detector: true,
  carbon_monoxide_detector: true,
  water_heater_bracing: true,
  window_safety: 'if applicable',
  supplemental_property_tax: true,
};

/**
 * California Natural Hazard Zones
 */
export const CALIFORNIA_HAZARD_ZONES = {
  SPECIAL_FLOOD_HAZARD_AREA: 'Special Flood Hazard Area (Zone A or V)',
  EARTHQUAKE_FAULT_ZONE: 'Alquist-Priolo Earthquake Fault Zone',
  SEISMIC_HAZARD_ZONE: 'Seismic Hazard Zone',
  VERY_HIGH_FIRE_HAZARD_SEVERITY_ZONE: 'Very High Fire Hazard Severity Zone',
  WILDLAND_URBAN_INTERFACE_FIRE_AREA: 'Wildland-Urban Interface Fire Area',
  DAM_INUNDATION_ZONE: 'Dam Inundation Zone',
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
 * Generate California-specific addendum
 */
export function generateCaliforniaAddendum(vars: CaliforniaAddendumVariables): string {
  const needsLeadPaint = vars.property_year_built && vars.property_year_built < 1978;

  return `
================================================================================
                 CALIFORNIA ADDENDUM TO PURCHASE AGREEMENT
================================================================================

This Addendum is attached to and made part of the Real Estate Purchase Agreement
dated ${formatDate(vars.contract_date)} between:

Seller: ${vars.seller_name}
Buyer: ${vars.buyer_name}

Property: ${vars.property_address}
City: ${vars.property_city}
County: ${vars.property_county}

--------------------------------------------------------------------------------
               SECTION A: TRANSFER DISCLOSURE STATEMENT (TDS)
--------------------------------------------------------------------------------

                CALIFORNIA TRANSFER DISCLOSURE STATEMENT
             (Required by California Civil Code Section 1102)

California law requires sellers of residential real property (1-4 units) to
provide buyers with a Transfer Disclosure Statement (TDS) disclosing the
condition of the Property.

TDS STATUS:

[ ${vars.tds_attached ? 'X' : ' '} ] Transfer Disclosure Statement is attached to this Addendum.
[ ${!vars.tds_attached ? 'X' : ' '} ] Transfer Disclosure Statement to be delivered within 3 days.

SELLER'S DISCLOSURE OBLIGATIONS:

The Seller must disclose:
1. All known material facts affecting the value or desirability of the Property
2. The condition of structural components, plumbing, electrical, heating/cooling
3. Any room additions, alterations, or repairs made without permits
4. Neighborhood noise, nuisances, or other factors
5. Homeowners association information (if applicable)
6. Flooding, drainage, or grading issues
7. Presence of hazardous substances

IMPORTANT: Seller's duty to disclose continues after delivery of the TDS.
If Seller becomes aware of additional material facts, Seller must amend the TDS.

BUYER'S RIGHTS:

1. Buyer has 3 days after personal delivery (5 days after mailing) of the TDS
   to terminate the contract based on information in the TDS.

2. Buyer waives the right to terminate if Buyer does not deliver a written
   termination notice within the applicable time period.

BUYER'S INITIALS: _______  SELLER'S INITIALS: _______

--------------------------------------------------------------------------------
               SECTION B: NATURAL HAZARD DISCLOSURE (NHD)
--------------------------------------------------------------------------------

                  CALIFORNIA NATURAL HAZARD DISCLOSURE
             (Required by California Civil Code Section 1103)

California law requires sellers to disclose whether the Property is located
in certain natural hazard areas.

NHD REPORT STATUS:

[ ${vars.nhd_report_attached ? 'X' : ' '} ] Natural Hazard Disclosure Report is attached.
[ ${!vars.nhd_report_attached ? 'X' : ' '} ] Natural Hazard Disclosure Report to be provided within 5 days.

REQUIRED NATURAL HAZARD ZONES:

The following disclosures are REQUIRED by California law:

1. SPECIAL FLOOD HAZARD AREA (SFHA)
   [ ${vars.special_flood_hazard_area ? 'X' : ' '} ] The Property IS in a Special Flood Hazard Area
   [ ${!vars.special_flood_hazard_area ? 'X' : ' '} ] The Property IS NOT in a Special Flood Hazard Area
   (Federal flood insurance may be required for properties in flood zones)

2. ALQUIST-PRIOLO EARTHQUAKE FAULT ZONE
   [ ${vars.earthquake_fault_zone ? 'X' : ' '} ] The Property IS in an Earthquake Fault Zone
   [ ${!vars.earthquake_fault_zone ? 'X' : ' '} ] The Property IS NOT in an Earthquake Fault Zone
   (Properties in fault zones may be subject to restrictions on construction)

3. SEISMIC HAZARD ZONE
   [ ] The Property IS in a Seismic Hazard Zone
   [ ] The Property IS NOT in a Seismic Hazard Zone
   (Areas susceptible to liquefaction or earthquake-induced landslides)

4. VERY HIGH FIRE HAZARD SEVERITY ZONE
   [ ${vars.fire_hazard_zone ? 'X' : ' '} ] The Property IS in a Very High Fire Hazard Severity Zone
   [ ${!vars.fire_hazard_zone ? 'X' : ' '} ] The Property IS NOT in a Very High Fire Hazard Severity Zone
   (State Responsibility Area fire zones - special building requirements may apply)

5. WILDLAND-URBAN INTERFACE FIRE AREA
   [ ] The Property IS in a Wildland-Urban Interface Fire Area
   [ ] The Property IS NOT in a Wildland-Urban Interface Fire Area
   (Local fire agency fire zones)

6. DAM INUNDATION ZONE
   [ ] The Property IS in a Dam Inundation Zone
   [ ] The Property IS NOT in a Dam Inundation Zone
   (Area that could be flooded in event of dam failure)

ADDITIONAL HAZARD DISCLOSURES (as applicable):

[ ] Former military ordnance location (within 1 mile)
[ ] Airport influence area
[ ] Mello-Roos Community Facilities District
[ ] Special assessment district

BUYER'S INITIALS: _______

--------------------------------------------------------------------------------
                   SECTION C: MEGAN'S LAW DISCLOSURE
--------------------------------------------------------------------------------

                     CALIFORNIA MEGAN'S LAW DISCLOSURE
              (Required by California Civil Code Section 2079.10a)

NOTICE: Pursuant to Section 290.46 of the Penal Code, information about
specified registered sex offenders is made available to the public via an
Internet Web site maintained by the Department of Justice at
www.meganslaw.ca.gov.

Depending on an offender's criminal history, this information will include
either the address at which the offender resides or the community of residence
and ZIP Code in which he or she resides.

THE CALIFORNIA DEPARTMENT OF JUSTICE MAINTAINS A DATABASE OF THE LOCATIONS
OF PERSONS REQUIRED TO REGISTER UNDER MEGAN'S LAW.

Buyer is encouraged to access this database to determine the locations of
registered sex offenders in the neighborhood of the Property.

IMPORTANT: Neither Seller nor any real estate agent is required to disclose
the location of registered sex offenders or check the Megan's Law database.

BUYER'S INITIALS: _______

--------------------------------------------------------------------------------
                  SECTION D: ADDITIONAL CALIFORNIA DISCLOSURES
--------------------------------------------------------------------------------

SMOKE DETECTOR STATEMENT OF COMPLIANCE:

California law requires operable smoke detectors in residential properties.
Seller shall deliver a written statement of compliance indicating that smoke
detectors are installed in accordance with applicable building codes.

[ ] Smoke Detector Statement of Compliance attached
[ ] Smoke Detector Statement of Compliance to be provided at closing

CARBON MONOXIDE DETECTOR:

California law (Health and Safety Code Section 13260) requires carbon monoxide
detectors in dwelling units with fossil fuel-burning appliances, attached
garages, or fireplaces.

[ ] Property has required carbon monoxide detectors
[ ] Property does not require carbon monoxide detectors

WATER HEATER BRACING:

Seller certifies that the water heater(s) have been braced, anchored, or
strapped in accordance with local codes (Health and Safety Code Section 19211).

[ ] Water heater(s) braced
[ ] Water heater bracing to be completed before closing
[ ] Not applicable

WINDOW SAFETY GLAZING:

California law requires disclosure of whether windows installed in bathrooms,
doors, and certain other locations contain safety glazing or tempered glass.

[ ] Property has safety glazing where required
[ ] Property may have windows without required safety glazing

${needsLeadPaint ? `
LEAD-BASED PAINT DISCLOSURE (Pre-1978 Property):

The Property was built in ${vars.property_year_built}, before 1978. Federal
and California law require disclosure of known lead-based paint hazards.

Seller discloses:
[ ] Seller has no knowledge of lead-based paint and/or hazards.
[ ] Seller has knowledge of the following: ___________________________

Buyer has received the EPA pamphlet "Protect Your Family From Lead in Your Home."

Buyer has 10 days to conduct a lead-based paint risk assessment or inspection.

Seller's Initials: _______ Buyer's Initials: _______
` : ''}

--------------------------------------------------------------------------------
               SECTION E: SUPPLEMENTAL PROPERTY TAX DISCLOSURE
--------------------------------------------------------------------------------

                 SUPPLEMENTAL PROPERTY TAX NOTICE

When property is sold or new construction is completed, California law requires
a supplemental assessment of the property to account for the difference between
the old and new assessed values.

IMPORTANT TAX INFORMATION:

1. A SUPPLEMENTAL tax bill will be issued based on the change in ownership.

2. The supplemental tax is prorated from the date of ownership change to the
   end of the current fiscal year (June 30).

3. A SECOND supplemental bill may also be issued for the next fiscal year
   if ownership changes after January 1.

4. Supplemental taxes are IN ADDITION to the regular property tax bill.

5. Supplemental taxes are NOT paid through escrow - they are billed directly
   to the new owner.

6. Failure to pay supplemental taxes may result in penalties, interest, and
   potential tax liens.

ESTIMATED SUPPLEMENTAL TAX:
Purchase Price: ${formatCurrency(vars.purchase_price)}
Current Assessed Value: [To be verified by Buyer]
Potential Supplemental Tax: [Buyer should consult ${vars.property_county} County Assessor]

BUYER SHOULD BUDGET FOR SUPPLEMENTAL PROPERTY TAXES AFTER PURCHASE.

BUYER'S INITIALS: _______

--------------------------------------------------------------------------------
                           SECTION F: SIGNATURES
--------------------------------------------------------------------------------

By signing below, the parties acknowledge receipt of all disclosures contained
herein and agree to be bound by the terms of this California Addendum.

SELLER:

Signature: _________________________________  Date: _______________

Print Name: ${vars.seller_name}


BUYER:

Signature: _________________________________  Date: _______________

Print Name: ${vars.buyer_name}


================================================================================
                       END OF CALIFORNIA ADDENDUM
================================================================================
`.trim();
}

/**
 * Get list of required California disclosures
 */
export function getCaliforniaRequiredDisclosures(
  propertyYearBuilt?: number,
  hazardZones?: { flood?: boolean; earthquake?: boolean; fire?: boolean }
): string[] {
  const disclosures = [
    'Transfer Disclosure Statement (Civil Code 1102)',
    'Natural Hazard Disclosure Statement (Civil Code 1103)',
    "Megan's Law Disclosure (Civil Code 2079.10a)",
    'Smoke Detector Statement of Compliance',
    'Carbon Monoxide Detector Compliance',
    'Water Heater Bracing (Health & Safety Code 19211)',
    'Supplemental Property Tax Notice',
  ];

  if (propertyYearBuilt && propertyYearBuilt < 1978) {
    disclosures.push('Lead-Based Paint Disclosure (Federal)');
  }

  if (hazardZones?.flood) {
    disclosures.push('Special Flood Hazard Area Notice');
  }

  if (hazardZones?.earthquake) {
    disclosures.push('Earthquake Fault Zone Notice');
  }

  if (hazardZones?.fire) {
    disclosures.push('Very High Fire Hazard Severity Zone Notice');
  }

  return disclosures;
}

export { formatCurrency as formatCaliforniaCurrency, formatDate as formatCaliforniaDate };
