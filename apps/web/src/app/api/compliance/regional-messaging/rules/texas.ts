/**
 * Texas Regional Compliance Rules
 *
 * Texas follows federal TCPA timing: 8am-9pm Central Time
 *
 * Texas Property Code:
 * - Specific disclosure requirements for RE transactions
 * - Executory contract requirements
 *
 * DTPA (Deceptive Trade Practices Act):
 * - Strong consumer protection
 * - Up to $10,000 per violation
 *
 * Real Estate Exemptions:
 * - Some exemptions for licensed real estate professionals
 * - Wholesaling is legal but disclosure-heavy
 */

import type { RegionalRules } from '../types';
import { FEDERAL_RULES } from './federal';

export const TEXAS_RULES: RegionalRules = {
  state: 'TX',
  timezone: 'America/Chicago',

  // Texas follows federal TCPA: 8am-9pm CT
  quietHours: {
    sms: { startHour: 8, endHour: 21 }, // 8am-9pm CT
    voice: { startHour: 8, endHour: 21 },
    rvm: { startHour: 8, endHour: 21 },
    email: null, // No time restrictions
  },

  disclosures: {
    sms: {
      firstMessage: [
        ...FEDERAL_RULES.disclosures.sms.firstMessage,
      ],
      subsequent: [
        ...FEDERAL_RULES.disclosures.sms.subsequent,
      ],
      realEstate: [
        ...FEDERAL_RULES.disclosures.sms.realEstate,
        'TX: We are investors, not licensed agents, and may assign contracts.',
      ],
      texasSpecific: [
        'Texas Property Code disclosures apply to any transaction.',
      ],
    },
    email: {
      required: [
        ...FEDERAL_RULES.disclosures.email.required,
      ],
      realEstate: [
        ...FEDERAL_RULES.disclosures.email.realEstate,
        'Texas Notice: We are real estate investors operating under Texas Property Code. We are not licensed real estate agents unless specifically disclosed.',
      ],
      canSpam: [
        ...FEDERAL_RULES.disclosures.email.canSpam,
      ],
      texasSpecific: [
        'Texas Deceptive Trade Practices Act protections apply.',
        'Executory contract requirements may apply to certain transactions.',
      ],
    },
    voice: {
      opener: [
        ...FEDERAL_RULES.disclosures.voice.opener,
      ],
      realEstate: [
        ...FEDERAL_RULES.disclosures.voice.realEstate,
        'Under Texas law, I must disclose that we are investors and may assign our purchase contract.',
      ],
    },
  },

  consentRequirements: {
    sms: {
      cold: 'prior_express_written',
      inbound: 'implied',
    },
    voice: {
      cold: 'prior_express',
      inbound: 'implied',
    },
    email: {
      cold: 'none',
      inbound: 'implied',
    },
  },

  frequencyLimits: {
    sms: {
      perDay: 3,
      perWeek: 10,
      perMonth: 30,
    },
    voice: {
      perDay: 2,
      perWeek: 7,
      perMonth: 20,
    },
    email: {
      perDay: 2,
      perWeek: 7,
      perMonth: 30,
    },
  },

  penalties: {
    tcpa: '$500-$1,500 per violation',
    dtpa: 'Up to $10,000 per violation, plus attorney fees',
    texasPropertyCode: 'Varies by violation type',
  },

  additionalNotes: [
    'Texas follows federal TCPA timing (8am-9pm CT)',
    'Texas Property Code governs real estate transactions',
    'Executory contracts have specific requirements',
    'Wholesaling is legal but requires proper disclosure',
    'DTPA provides strong consumer protections',
    'Some exemptions for licensed RE professionals',
    'Assignment fee disclosure may be required',
  ],

  stateSpecific: {
    realEstateExemptions: true,
    executoryContractRules: true,
    assignmentDisclosure: true,
    dtpaProtections: true,
  },
};

/**
 * Validate Texas quiet hours
 */
export function validateTexasQuietHours(
  channel: 'sms' | 'voice' | 'rvm' | 'email',
  timestamp: Date = new Date()
): { allowed: boolean; reason?: string; nextAllowedTime?: Date } {
  const hours = TEXAS_RULES.quietHours[channel];

  // Email has no time restrictions
  if (!hours) {
    return { allowed: true };
  }

  // Get hour in Texas timezone (Central)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TEXAS_RULES.timezone,
    hour: 'numeric',
    hour12: false,
  });
  const hourStr = formatter.format(timestamp);
  const hour = parseInt(hourStr, 10) === 24 ? 0 : parseInt(hourStr, 10);

  if (hour < hours.startHour || hour >= hours.endHour) {
    return {
      allowed: false,
      reason: `Texas TCPA: sending not allowed before ${hours.startHour}:00 AM or after ${hours.endHour - 12}:00 PM Central Time`,
      nextAllowedTime: calculateNextAllowedTexas(hours.startHour, timestamp),
    };
  }

  return { allowed: true };
}

/**
 * Get Texas-specific disclosures
 */
export function getTexasDisclosures(
  channel: 'sms' | 'email' | 'voice',
  context: {
    businessName: string;
    physicalAddress?: string;
    unsubscribeUrl?: string;
    isFirstMessage?: boolean;
    isRealEstate?: boolean;
    isExecutoryContract?: boolean;
  }
): string[] {
  const disclosures: string[] = [];
  const channelDisclosures = TEXAS_RULES.disclosures[channel];

  if (!channelDisclosures) return disclosures;

  // Add standard disclosures based on channel
  if (channel === 'sms') {
    const smsDisclosures = channelDisclosures as typeof TEXAS_RULES.disclosures.sms;
    if (context.isFirstMessage && smsDisclosures.firstMessage) {
      disclosures.push(...smsDisclosures.firstMessage);
    } else if (smsDisclosures.subsequent) {
      disclosures.push(...smsDisclosures.subsequent);
    }
    if (context.isRealEstate && smsDisclosures.realEstate) {
      disclosures.push(...smsDisclosures.realEstate);
    }
    if (smsDisclosures.texasSpecific) {
      disclosures.push(...smsDisclosures.texasSpecific);
    }
  }

  if (channel === 'email') {
    const emailDisclosures = channelDisclosures as typeof TEXAS_RULES.disclosures.email;
    if (emailDisclosures.canSpam) {
      disclosures.push(...emailDisclosures.canSpam);
    }
    if (context.isRealEstate && emailDisclosures.realEstate) {
      disclosures.push(...emailDisclosures.realEstate);
    }
    if (emailDisclosures.texasSpecific) {
      disclosures.push(...emailDisclosures.texasSpecific);
    }
  }

  if (channel === 'voice') {
    const voiceDisclosures = channelDisclosures as typeof TEXAS_RULES.disclosures.voice;
    if (voiceDisclosures.opener) {
      disclosures.push(...voiceDisclosures.opener);
    }
    if (context.isRealEstate && voiceDisclosures.realEstate) {
      disclosures.push(...voiceDisclosures.realEstate);
    }
  }

  // Add executory contract disclosures if applicable
  if (context.isExecutoryContract) {
    disclosures.push(
      'Texas Property Code Section 5.062 disclosures apply to this executory contract.',
      'You have certain rights under Texas law regarding executory contracts.'
    );
  }

  // Replace placeholders
  return disclosures.map((d) =>
    d
      .replace(/\{\{businessName\}\}/g, context.businessName)
      .replace(/\{\{physicalAddress\}\}/g, context.physicalAddress || '')
      .replace(/\{\{unsubscribeUrl\}\}/g, context.unsubscribeUrl || '')
  );
}

/**
 * Generate Texas-compliant email footer
 */
export function generateTexasFooter(context: {
  businessName: string;
  physicalAddress: string;
  unsubscribeUrl: string;
  privacyUrl: string;
}): string {
  return `
<div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-family: sans-serif; font-size: 11px; color: #64748b;">
  <p style="margin: 0 0 8px 0;">
    This message is from ${context.businessName}, a real estate investment company.
    We are not licensed real estate agents or brokers unless otherwise stated.
  </p>
  <p style="margin: 0 0 8px 0;">${context.physicalAddress}</p>
  <p style="margin: 0 0 8px 0;">
    <a href="${context.unsubscribeUrl}" style="color: #64748b;">Unsubscribe</a> |
    <a href="${context.privacyUrl}" style="color: #64748b;">Privacy Policy</a>
  </p>
  <p style="margin: 0 0 8px 0; padding: 8px; background: #f1f5f9; border-radius: 4px;">
    <strong>Texas Notice:</strong> We are real estate investors and may assign any purchase contract.
    Texas Property Code and Deceptive Trade Practices Act protections apply.
  </p>
</div>`.trim();
}

/**
 * Check if Texas real estate exemptions apply
 * Licensed RE professionals may have certain exemptions
 */
export function checkTexasRealEstateExemption(context: {
  isLicensedAgent: boolean;
  hasEstablishedRelationship: boolean;
}): { exempt: boolean; reason?: string } {
  if (context.isLicensedAgent && context.hasEstablishedRelationship) {
    return {
      exempt: true,
      reason: 'Licensed real estate professional with established business relationship',
    };
  }
  return { exempt: false };
}

/**
 * Calculate next allowed send time for Texas
 */
function calculateNextAllowedTexas(startHour: number, now: Date): Date {
  const next = new Date(now);

  // Get current hour in Texas timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TEXAS_RULES.timezone,
    hour: 'numeric',
    hour12: false,
  });
  const currentHour = parseInt(formatter.format(now), 10);

  if (currentHour >= startHour) {
    // After start time, next allowed is tomorrow at startHour
    next.setDate(next.getDate() + 1);
  }

  // Get timezone offset for Central Time
  const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
  const texasDate = new Date(now.toLocaleString('en-US', { timeZone: TEXAS_RULES.timezone }));
  const offsetMinutes = (utcDate.getTime() - texasDate.getTime()) / 60000;

  next.setUTCHours(startHour + offsetMinutes / 60, 0, 0, 0);

  return next;
}

export { TEXAS_RULES as default };
