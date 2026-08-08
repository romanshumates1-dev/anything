/**
 * Regional Email Compliance, Regulatory, and Legal Rules
 *
 * Covers:
 * - Federal regulations (CAN-SPAM, TCPA)
 * - State-specific marketing laws
 * - Real estate specific disclosures
 * - International (GDPR, CASL for edge cases)
 *
 * Each region has:
 * - Required disclosures
 * - Prohibited content
 * - Timing restrictions
 * - Opt-out requirements
 * - Penalties for violations
 */

export interface RegionalRule {
  region: string;
  jurisdiction: 'federal' | 'state' | 'international';
  category: 'email' | 'sms' | 'call' | 'all';
  rules: {
    requiredDisclosures: string[];
    prohibitedContent: string[];
    timingRestrictions?: {
      allowedHours: { start: number; end: number };
      timezone: string;
      blackoutDays?: string[];
    };
    optOutRequirements: string[];
    penalties?: string;
    additionalNotes?: string[];
  };
}

// ════════════════════════════════════════════════════════════════════
// FEDERAL REGULATIONS (USA)
// ════════════════════════════════════════════════════════════════════

export const FEDERAL_CAN_SPAM: RegionalRule = {
  region: 'USA',
  jurisdiction: 'federal',
  category: 'email',
  rules: {
    requiredDisclosures: [
      'Physical postal address of sender',
      'Clear identification as advertisement (if applicable)',
      'Valid "From" and "Reply-To" headers',
      'Accurate subject line (no deception)',
    ],
    prohibitedContent: [
      'False or misleading header information',
      'Deceptive subject lines',
      'Harvested email addresses without consent',
    ],
    optOutRequirements: [
      'Visible, operable unsubscribe mechanism',
      'Honor opt-out within 10 business days',
      'Opt-out mechanism valid for 30 days after send',
      'Cannot require fee or personal info beyond email for opt-out',
      'Cannot sell/transfer opted-out addresses',
    ],
    penalties: 'Up to $50,120 per violation (2024 adjusted)',
    additionalNotes: [
      'Applies to commercial messages promoting goods/services',
      'Transactional messages (contract confirmations) exempt from some requirements',
      'Each separate email violation is a separate offense',
    ],
  },
};

export const FEDERAL_TCPA: RegionalRule = {
  region: 'USA',
  jurisdiction: 'federal',
  category: 'all',
  rules: {
    requiredDisclosures: [
      'Caller identity at beginning of call/message',
      'Business name and contact information',
      'Purpose of the call/message',
    ],
    prohibitedContent: [
      'Calls/texts to numbers on National DNC Registry (without consent)',
      'Prerecorded messages without prior express consent',
      'Auto-dialed calls to cell phones without consent',
      'Texts without prior express written consent',
    ],
    timingRestrictions: {
      allowedHours: { start: 8, end: 21 },
      timezone: 'recipient_local',
      blackoutDays: [],
    },
    optOutRequirements: [
      'Immediate opt-out mechanism for calls',
      'STOP keyword support for SMS',
      'Honor DNC requests within 30 days',
      'Maintain internal DNC list for 5 years',
    ],
    penalties: '$500-$1,500 per violation (treble damages for willful)',
    additionalNotes: [
      'Prior express written consent required for marketing texts',
      'Established business relationship exemption limited',
      'Real estate inquiries may have different consent standards',
    ],
  },
};

// ════════════════════════════════════════════════════════════════════
// STATE-SPECIFIC REGULATIONS
// ════════════════════════════════════════════════════════════════════

export const STATE_CALIFORNIA: RegionalRule = {
  region: 'CA',
  jurisdiction: 'state',
  category: 'all',
  rules: {
    requiredDisclosures: [
      'CCPA privacy notice link (if applicable)',
      '"Do Not Sell My Personal Information" link',
      'California-specific real estate disclosures',
      'License number if licensed RE professional',
    ],
    prohibitedContent: [
      'Misleading property condition claims',
      'False urgency or scarcity claims',
      'Undisclosed material facts about property',
    ],
    timingRestrictions: {
      allowedHours: { start: 8, end: 21 },
      timezone: 'America/Los_Angeles',
    },
    optOutRequirements: [
      'Honor California Consumer Privacy Act requests',
      'Provide data deletion upon request',
      'Do not discriminate against opt-out requesters',
    ],
    penalties: '$2,500-$7,500 per intentional CCPA violation',
    additionalNotes: [
      'CalDRE requires specific disclosures for wholesaling',
      'Assignment contracts may require additional disclosures',
      'Anti-equity stripping laws apply to distressed properties',
    ],
  },
};

export const STATE_TEXAS: RegionalRule = {
  region: 'TX',
  jurisdiction: 'state',
  category: 'all',
  rules: {
    requiredDisclosures: [
      'Company name and physical address',
      'Clear statement if not a licensed RE agent',
      'Disclosure that buyer is an investor (if applicable)',
      'Property condition disclosure requirements',
    ],
    prohibitedContent: [
      'Deceptive trade practices',
      'False claims about market value',
      'Misleading contract terms',
      'Undisclosed assignment intentions',
    ],
    timingRestrictions: {
      allowedHours: { start: 8, end: 21 },
      timezone: 'America/Chicago',
    },
    optOutRequirements: [
      'Honor state DNC list',
      'Standard CAN-SPAM opt-out compliance',
    ],
    penalties: 'DTPA violations: up to $10,000 per violation',
    additionalNotes: [
      'Texas Property Code governs RE transactions',
      'Executory contracts have specific requirements',
      'Wholesaling is legal but disclosure-heavy',
    ],
  },
};

export const STATE_FLORIDA: RegionalRule = {
  region: 'FL',
  jurisdiction: 'state',
  category: 'all',
  rules: {
    requiredDisclosures: [
      'Florida DBPR license number (if licensed)',
      'Statement if operating as unlicensed investor',
      'Material fact disclosures for property',
      'Assignment/wholesale disclosure',
    ],
    prohibitedContent: [
      'Unlicensed brokerage activity',
      'Misleading repair cost estimates',
      'False timeline promises',
      'Undisclosed property defects knowledge',
    ],
    timingRestrictions: {
      allowedHours: { start: 8, end: 21 },
      timezone: 'America/New_York',
    },
    optOutRequirements: [
      'Florida Telemarketing Act compliance',
      'Three-day cooling off period disclosure',
      'Standard email opt-out requirements',
    ],
    penalties: 'FDUTPA: $10,000+ per violation',
    additionalNotes: [
      'Florida has strong anti-fraud statutes',
      'Homestead exemption complicates some transactions',
      'Hurricane disclosure requirements in some areas',
    ],
  },
};

export const STATE_GEORGIA: RegionalRule = {
  region: 'GA',
  jurisdiction: 'state',
  category: 'all',
  rules: {
    requiredDisclosures: [
      'Company registration information',
      'Clear investor disclosure',
      'Property condition knowledge disclosure',
    ],
    prohibitedContent: [
      'Deceptive practices under FBPA',
      'Misleading financial terms',
      'False claims about property value',
    ],
    timingRestrictions: {
      allowedHours: { start: 8, end: 21 },
      timezone: 'America/New_York',
    },
    optOutRequirements: [
      'Standard federal compliance',
      'Georgia-specific telemarketing rules',
    ],
    penalties: 'Fair Business Practices Act penalties apply',
    additionalNotes: [
      'Georgia requires seller property disclosure',
      'Foreclosure prevention laws in effect',
    ],
  },
};

export const STATE_OHIO: RegionalRule = {
  region: 'OH',
  jurisdiction: 'state',
  category: 'all',
  rules: {
    requiredDisclosures: [
      'Business entity registration',
      'Material defect disclosures',
      'Lead paint disclosure (pre-1978)',
    ],
    prohibitedContent: [
      'Consumer Sales Practices Act violations',
      'Unconscionable contract terms',
      'Deceptive pricing claims',
    ],
    timingRestrictions: {
      allowedHours: { start: 8, end: 21 },
      timezone: 'America/New_York',
    },
    optOutRequirements: [
      'Ohio Telephone Solicitation Sales Act compliance',
      'Standard email requirements',
    ],
    penalties: 'CSPA: $25,000 per pattern of violations',
    additionalNotes: [
      'Ohio residential property disclosure form required',
      'Title insurance requirements vary by county',
    ],
  },
};

export const STATE_NORTH_CAROLINA: RegionalRule = {
  region: 'NC',
  jurisdiction: 'state',
  category: 'all',
  rules: {
    requiredDisclosures: [
      'Residential Property Disclosure Statement',
      'Mineral and oil/gas rights disclosure',
      'Synthetic stucco disclosure',
      'Business entity information',
    ],
    prohibitedContent: [
      'Unfair or deceptive trade practices',
      'Misleading property condition claims',
      'Unauthorized practice of law (contract preparation)',
    ],
    timingRestrictions: {
      allowedHours: { start: 8, end: 21 },
      timezone: 'America/New_York',
    },
    optOutRequirements: [
      'NC Telephone Solicitations Act compliance',
      'State registry checks required',
    ],
    penalties: 'UDTPA: up to $5,000 per violation',
    additionalNotes: [
      'North Carolina has specific wholesaling guidance',
      'Attorney must prepare deed in most transactions',
    ],
  },
};

export const STATE_TENNESSEE: RegionalRule = {
  region: 'TN',
  jurisdiction: 'state',
  category: 'all',
  rules: {
    requiredDisclosures: [
      'Property condition disclosure',
      'Business identification',
      'Investor status disclosure',
    ],
    prohibitedContent: [
      'Tennessee Consumer Protection Act violations',
      'Deceptive representations',
      'Misleading contract terms',
    ],
    timingRestrictions: {
      allowedHours: { start: 8, end: 21 },
      timezone: 'America/Chicago',
    },
    optOutRequirements: [
      'Standard federal requirements',
      'Tennessee-specific telemarketing rules',
    ],
    penalties: 'TCPA (state): varies by violation type',
    additionalNotes: [
      'Tennessee allows wholesaling with proper disclosure',
      'Specific foreclosure notification requirements',
    ],
  },
};

// ════════════════════════════════════════════════════════════════════
// REAL ESTATE SPECIFIC RULES
// ════════════════════════════════════════════════════════════════════

export const REAL_ESTATE_WHOLESALING: RegionalRule = {
  region: 'USA',
  jurisdiction: 'federal',
  category: 'all',
  rules: {
    requiredDisclosures: [
      'Disclosure that buyer intends to assign contract',
      'Clear statement of assignment fee (some states)',
      'Disclosure that buyer may not close themselves',
      'Statement that seller can reject assignment (if applicable)',
      'Notice that buyer is investor, not end-user',
    ],
    prohibitedContent: [
      'Claiming to be licensed agent without license',
      'Marketing property without equitable interest',
      'Promising specific sale price without basis',
      'Claiming to represent seller as agent',
      'Hiding assignment/wholesale nature of transaction',
    ],
    optOutRequirements: [
      'Standard marketing opt-out requirements',
      'Contract cancellation rights disclosure',
    ],
    penalties: 'Varies by state - unlicensed activity penalties',
    additionalNotes: [
      'Must have equitable interest before marketing to end buyers',
      'Assignment clauses should be clear and conspicuous',
      'Some states require specific contract language',
      'Earnest money deposit shows good faith',
      'Title company involvement protects all parties',
    ],
  },
};

export const DISTRESSED_PROPERTY_RULES: RegionalRule = {
  region: 'USA',
  jurisdiction: 'federal',
  category: 'all',
  rules: {
    requiredDisclosures: [
      'Right to cancel within specified period (varies by state)',
      'Statement that owner may lose home',
      'Notice of alternatives (HUD counseling)',
      'Clear explanation of transaction terms',
      'Disclosure of equity being purchased',
    ],
    prohibitedContent: [
      'High-pressure tactics on distressed owners',
      'Misrepresenting foreclosure timeline',
      'Promising to stop foreclosure without ability',
      'Taking title without clear consideration',
      'Lease-back schemes without full disclosure',
    ],
    optOutRequirements: [
      'Extended cancellation periods (5-10 days typical)',
      'Written notice of cancellation rights',
    ],
    penalties: 'Equity stripping: criminal penalties in some states',
    additionalNotes: [
      'FTC Mortgage Assistance Relief Services Rule applies',
      'State equity purchase laws vary significantly',
      'HUD requirements for FHA-insured properties',
      'Heightened disclosure for pre-foreclosure',
    ],
  },
};

// ════════════════════════════════════════════════════════════════════
// INTERNATIONAL (FOR COMPLETENESS)
// ════════════════════════════════════════════════════════════════════

export const GDPR_EU: RegionalRule = {
  region: 'EU',
  jurisdiction: 'international',
  category: 'email',
  rules: {
    requiredDisclosures: [
      'Data controller identity',
      'Purpose of data processing',
      'Legal basis for processing',
      'Data retention period',
      'Rights of data subject',
      'Right to lodge complaint with authority',
    ],
    prohibitedContent: [
      'Processing without lawful basis',
      'Marketing without explicit consent',
      'Transferring data outside EU without safeguards',
    ],
    optOutRequirements: [
      'Explicit opt-in required (no pre-checked boxes)',
      'Easy withdrawal of consent',
      'Right to erasure (right to be forgotten)',
      'Right to data portability',
    ],
    penalties: 'Up to €20M or 4% of global annual revenue',
    additionalNotes: [
      'Generally not applicable to US-only real estate operations',
      'May apply if marketing to EU residents',
      'Privacy Shield invalidated - use SCCs for data transfer',
    ],
  },
};

export const CASL_CANADA: RegionalRule = {
  region: 'Canada',
  jurisdiction: 'international',
  category: 'email',
  rules: {
    requiredDisclosures: [
      'Sender identification',
      'Contact information',
      'Unsubscribe mechanism',
    ],
    prohibitedContent: [
      'Commercial messages without express consent',
      'Implied consent beyond 2-year limit',
      'False or misleading sender info',
    ],
    optOutRequirements: [
      'Express consent required for commercial messages',
      'Unsubscribe within 10 business days',
      'Unsubscribe mechanism valid for 60 days',
    ],
    penalties: 'Up to $10M CAD per violation',
    additionalNotes: [
      'Stricter than CAN-SPAM - requires opt-in',
      'May apply to cross-border marketing',
    ],
  },
};

// ════════════════════════════════════════════════════════════════════
// COMPLIANCE CHECKER
// ════════════════════════════════════════════════════════════════════

export const ALL_REGIONAL_RULES: RegionalRule[] = [
  // Federal
  FEDERAL_CAN_SPAM,
  FEDERAL_TCPA,
  // States
  STATE_CALIFORNIA,
  STATE_TEXAS,
  STATE_FLORIDA,
  STATE_GEORGIA,
  STATE_OHIO,
  STATE_NORTH_CAROLINA,
  STATE_TENNESSEE,
  // Real Estate Specific
  REAL_ESTATE_WHOLESALING,
  DISTRESSED_PROPERTY_RULES,
  // International
  GDPR_EU,
  CASL_CANADA,
];

/**
 * Get all applicable rules for a region and channel
 */
export function getRulesForRegion(
  stateCode: string,
  channel: 'email' | 'sms' | 'call'
): RegionalRule[] {
  const rules: RegionalRule[] = [];

  // Always add federal rules
  rules.push(FEDERAL_CAN_SPAM);
  rules.push(FEDERAL_TCPA);

  // Add real estate specific rules
  rules.push(REAL_ESTATE_WHOLESALING);
  rules.push(DISTRESSED_PROPERTY_RULES);

  // Add state-specific rules
  const stateRule = ALL_REGIONAL_RULES.find(
    r => r.region === stateCode && r.jurisdiction === 'state'
  );
  if (stateRule) {
    rules.push(stateRule);
  }

  // Filter by channel
  return rules.filter(r => r.category === 'all' || r.category === channel);
}

/**
 * Get required disclosures for an email
 */
export function getRequiredDisclosures(
  stateCode: string,
  isDistressed: boolean = false
): string[] {
  const rules = getRulesForRegion(stateCode, 'email');
  const disclosures = new Set<string>();

  for (const rule of rules) {
    for (const disclosure of rule.rules.requiredDisclosures) {
      disclosures.add(disclosure);
    }
  }

  if (isDistressed) {
    const distressRules = DISTRESSED_PROPERTY_RULES.rules.requiredDisclosures;
    for (const d of distressRules) {
      disclosures.add(d);
    }
  }

  return Array.from(disclosures);
}

/**
 * Check if a time is within allowed sending hours
 */
export function isWithinAllowedHours(
  stateCode: string,
  timestamp: Date = new Date()
): { allowed: boolean; reason?: string } {
  const stateRule = ALL_REGIONAL_RULES.find(
    r => r.region === stateCode && r.jurisdiction === 'state'
  );

  const restrictions = stateRule?.rules.timingRestrictions || FEDERAL_TCPA.rules.timingRestrictions;

  if (!restrictions) {
    return { allowed: true };
  }

  // Convert to recipient's timezone
  const recipientTime = new Intl.DateTimeFormat('en-US', {
    timeZone: restrictions.timezone === 'recipient_local' ? 'America/New_York' : restrictions.timezone,
    hour: 'numeric',
    hour12: false,
  }).format(timestamp);

  const hour = parseInt(recipientTime, 10);

  if (hour < restrictions.allowedHours.start || hour >= restrictions.allowedHours.end) {
    return {
      allowed: false,
      reason: `Outside allowed hours (${restrictions.allowedHours.start}:00-${restrictions.allowedHours.end}:00 ${restrictions.timezone})`,
    };
  }

  // Check blackout days
  if (restrictions.blackoutDays?.length) {
    const dayName = timestamp.toLocaleDateString('en-US', { weekday: 'long' });
    if (restrictions.blackoutDays.includes(dayName)) {
      return {
        allowed: false,
        reason: `Blackout day: ${dayName}`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Generate compliance footer for emails
 */
export function generateComplianceFooter(
  stateCode: string,
  physicalAddress: string,
  unsubscribeUrl: string,
  isDistressed: boolean = false
): string {
  const disclosures = getRequiredDisclosures(stateCode, isDistressed);

  let footer = `
    <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-family: sans-serif; font-size: 11px; color: #64748b;">
      <p style="margin: 0 0 8px 0;">
        This message is from a real estate investor, not a licensed real estate agent or broker (unless otherwise stated).
        We are interested in purchasing your property for investment purposes.
      </p>
      <p style="margin: 0 0 8px 0;">${physicalAddress}</p>
      <p style="margin: 0 0 8px 0;">
        <a href="${unsubscribeUrl}" style="color: #64748b;">Unsubscribe</a> |
        <a href="${unsubscribeUrl.replace('unsubscribe', 'privacy')}" style="color: #64748b;">Privacy Policy</a>
      </p>
  `;

  if (stateCode === 'CA') {
    footer += `
      <p style="margin: 0 0 8px 0;">
        California residents: <a href="${unsubscribeUrl.replace('unsubscribe', 'ccpa')}" style="color: #64748b;">Do Not Sell My Personal Information</a>
      </p>
    `;
  }

  if (isDistressed) {
    footer += `
      <p style="margin: 8px 0; padding: 8px; background: #fef3c7; border-radius: 4px; color: #92400e;">
        <strong>Important:</strong> You have the right to cancel this transaction.
        For free housing counseling, contact HUD at 1-800-569-4287.
      </p>
    `;
  }

  footer += '</div>';
  return footer;
}

/**
 * Validate email content against compliance rules
 */
export function validateEmailCompliance(
  stateCode: string,
  subject: string,
  htmlContent: string,
  isDistressed: boolean = false
): { compliant: boolean; issues: string[] } {
  const issues: string[] = [];
  const rules = getRulesForRegion(stateCode, 'email');

  // Check for prohibited content
  const lowerContent = htmlContent.toLowerCase();
  const lowerSubject = subject.toLowerCase();

  // Deceptive subject line checks
  if (lowerSubject.includes('re:') && !htmlContent.includes('In reply to')) {
    issues.push('Subject line appears deceptive (fake RE:)');
  }
  if (lowerSubject.includes('fwd:') && !htmlContent.includes('forwarded')) {
    issues.push('Subject line appears deceptive (fake FWD:)');
  }

  // Check for required elements
  if (!htmlContent.includes('unsubscribe')) {
    issues.push('Missing unsubscribe link (CAN-SPAM)');
  }

  // Check for physical address
  const hasAddress = /\d+\s+[\w\s]+,\s*[\w\s]+,\s*[A-Z]{2}\s+\d{5}/.test(htmlContent);
  if (!hasAddress) {
    issues.push('Missing physical postal address (CAN-SPAM)');
  }

  // Real estate specific checks
  if (lowerContent.includes('guaranteed') && lowerContent.includes('price')) {
    issues.push('Avoid guaranteeing specific prices without basis');
  }

  // Distressed property checks
  if (isDistressed) {
    if (!lowerContent.includes('right to cancel')) {
      issues.push('Missing right to cancel disclosure for distressed property');
    }
    if (lowerContent.includes('foreclosure') && lowerContent.includes('stop')) {
      if (!lowerContent.includes('may') && !lowerContent.includes('might')) {
        issues.push('Avoid absolute promises about stopping foreclosure');
      }
    }
  }

  return {
    compliant: issues.length === 0,
    issues,
  };
}
