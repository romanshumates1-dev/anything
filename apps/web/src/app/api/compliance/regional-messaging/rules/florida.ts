/**
 * Florida Regional Compliance Rules
 *
 * Florida has STRICTER quiet hours than federal TCPA:
 * - Florida Telemarketing Act: 8am-8pm (not 9pm)
 *
 * Florida DBPR (Department of Business and Professional Regulation):
 * - Specific real estate disclosure requirements
 * - Written consent requirements for certain communications
 *
 * FDUTPA (Florida Deceptive and Unfair Trade Practices Act):
 * - Strong anti-fraud protections
 * - $10,000+ per violation
 */

import type { RegionalRules } from '../types';
import { FEDERAL_RULES } from './federal';

export const FLORIDA_RULES: RegionalRules = {
  state: 'FL',
  timezone: 'America/New_York',

  // STRICTER than federal: 8am-8pm (federal allows until 9pm)
  quietHours: {
    sms: { startHour: 8, endHour: 20 }, // 8am-8pm ET - STRICTER
    voice: { startHour: 8, endHour: 20 }, // 8am-8pm ET - STRICTER
    rvm: { startHour: 8, endHour: 20 }, // 8am-8pm ET - STRICTER
    email: null, // No time restrictions for email
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
        ...(FEDERAL_RULES.disclosures.sms.realEstate || []),
        'FL: We are real estate investors and may assign contracts.',
      ],
      floridaSpecific: [
        'FL Telemarketing Act: You may request to be added to our do-not-call list.',
      ],
    },
    email: {
      required: [
        ...FEDERAL_RULES.disclosures.email.required,
      ],
      realEstate: [
        ...(FEDERAL_RULES.disclosures.email.realEstate || []),
        'Florida Notice: We are real estate investors operating in compliance with Florida law. We may assign any purchase contract to another investor.',
      ],
      canSpam: [
        ...FEDERAL_RULES.disclosures.email.canSpam,
      ],
      floridaSpecific: [
        'Florida residents: You have a 3-day cooling off period for home solicitation sales.',
      ],
    },
    voice: {
      opener: [
        ...FEDERAL_RULES.disclosures.voice.opener,
      ],
      realEstate: [
        ...(FEDERAL_RULES.disclosures.voice.realEstate || []),
        'Under Florida law, I must inform you that we are investors who may assign our contract.',
      ],
    },
  },

  consentRequirements: {
    sms: {
      cold: 'prior_express_written', // Florida requires written consent
      inbound: 'implied',
    },
    voice: {
      cold: 'prior_express_written', // Stricter than federal
      inbound: 'implied',
    },
    email: {
      cold: 'none',
      inbound: 'implied',
    },
  },

  frequencyLimits: {
    sms: {
      perDay: 2, // More conservative for Florida
      perWeek: 7,
      perMonth: 20,
    },
    voice: {
      perDay: 1, // Florida is more strict
      perWeek: 5,
      perMonth: 15,
    },
    email: {
      perDay: 2,
      perWeek: 7,
      perMonth: 30,
    },
  },

  penalties: {
    tcpa: '$500-$1,500 per violation',
    floridaTelemarketing: 'Up to $10,000 per violation',
    fdutpa: '$10,000+ per violation, plus attorney fees',
  },

  additionalNotes: [
    'Florida Telemarketing Act has stricter hours: 8am-8pm (not 9pm)',
    'Written consent required for telemarketing calls',
    'Three-day cooling off period disclosure required',
    'Florida DBPR may require license disclosure',
    'Strong anti-fraud statutes under FDUTPA',
    'Homestead exemption complicates some transactions',
    'Hurricane disclosure requirements in certain areas',
  ],

  stateSpecific: {
    stricterQuietHours: true,
    writtenConsentRequired: true,
    coolingOffPeriod: 3, // 3-day cooling off period
    hurricaneDisclosure: true, // Required in hurricane-prone areas
  },
};

/**
 * Validate Florida quiet hours (STRICTER than federal)
 */
export function validateFloridaQuietHours(
  channel: 'sms' | 'voice' | 'rvm' | 'email',
  timestamp: Date = new Date()
): { allowed: boolean; reason?: string; nextAllowedTime?: Date } {
  const hours = FLORIDA_RULES.quietHours[channel];

  // Email has no time restrictions
  if (!hours) {
    return { allowed: true };
  }

  // Get hour in Florida timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: FLORIDA_RULES.timezone,
    hour: 'numeric',
    hour12: false,
  });
  const hourStr = formatter.format(timestamp);
  const hour = parseInt(hourStr, 10) === 24 ? 0 : parseInt(hourStr, 10);

  if (hour < hours.startHour || hour >= hours.endHour) {
    return {
      allowed: false,
      reason: `Florida Telemarketing Act: sending not allowed before ${hours.startHour}:00 AM or after ${hours.endHour - 12}:00 PM Eastern Time (stricter than federal 9pm cutoff)`,
      nextAllowedTime: calculateNextAllowedFlorida(hours.startHour, timestamp),
    };
  }

  return { allowed: true };
}

/**
 * Get Florida-specific disclosures
 */
export function getFloridaDisclosures(
  channel: 'sms' | 'email' | 'voice',
  context: {
    businessName: string;
    physicalAddress?: string;
    unsubscribeUrl?: string;
    isFirstMessage?: boolean;
    isRealEstate?: boolean;
    isHurricaneZone?: boolean;
  }
): string[] {
  const disclosures: string[] = [];
  const channelDisclosures = FLORIDA_RULES.disclosures[channel];

  if (!channelDisclosures) return disclosures;

  // Add standard disclosures based on channel
  if (channel === 'sms') {
    const smsDisclosures = channelDisclosures as typeof FLORIDA_RULES.disclosures.sms;
    if (context.isFirstMessage && smsDisclosures.firstMessage) {
      disclosures.push(...smsDisclosures.firstMessage);
    } else if (smsDisclosures.subsequent) {
      disclosures.push(...smsDisclosures.subsequent);
    }
    if (context.isRealEstate && smsDisclosures.realEstate) {
      disclosures.push(...smsDisclosures.realEstate);
    }
    if (smsDisclosures.floridaSpecific) {
      disclosures.push(...smsDisclosures.floridaSpecific);
    }
  }

  if (channel === 'email') {
    const emailDisclosures = channelDisclosures as typeof FLORIDA_RULES.disclosures.email;
    if (emailDisclosures.canSpam) {
      disclosures.push(...emailDisclosures.canSpam);
    }
    if (context.isRealEstate && emailDisclosures.realEstate) {
      disclosures.push(...emailDisclosures.realEstate);
    }
    if (emailDisclosures.floridaSpecific) {
      disclosures.push(...emailDisclosures.floridaSpecific);
    }
  }

  if (channel === 'voice') {
    const voiceDisclosures = channelDisclosures as typeof FLORIDA_RULES.disclosures.voice;
    if (voiceDisclosures.opener) {
      disclosures.push(...voiceDisclosures.opener);
    }
    if (context.isRealEstate && voiceDisclosures.realEstate) {
      disclosures.push(...voiceDisclosures.realEstate);
    }
  }

  // Add hurricane zone disclosure if applicable
  if (context.isHurricaneZone) {
    disclosures.push(
      'Florida law requires disclosure of any known hurricane damage or flood zone status.'
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
 * Generate Florida-compliant email footer
 */
export function generateFloridaFooter(context: {
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
  <p style="margin: 0 0 8px 0; padding: 8px; background: #fef3c7; border-radius: 4px; color: #92400e;">
    <strong>Florida Notice:</strong> You have a 3-day cooling off period for home solicitation sales.
    This is a solicitation to purchase your property for investment purposes.
  </p>
</div>`.trim();
}

/**
 * Calculate next allowed send time for Florida
 */
function calculateNextAllowedFlorida(startHour: number, now: Date): Date {
  const next = new Date(now);

  // Get current hour in Florida timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: FLORIDA_RULES.timezone,
    hour: 'numeric',
    hour12: false,
  });
  const currentHour = parseInt(formatter.format(now), 10);

  if (currentHour >= startHour) {
    // After start time, next allowed is tomorrow at startHour
    next.setDate(next.getDate() + 1);
  }

  // Approximate setting to startHour in Eastern Time
  // This assumes EST (-5) or EDT (-4); Intl handles DST
  const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
  const floridaDate = new Date(now.toLocaleString('en-US', { timeZone: FLORIDA_RULES.timezone }));
  const offsetMinutes = (utcDate.getTime() - floridaDate.getTime()) / 60000;

  next.setUTCHours(startHour + offsetMinutes / 60, 0, 0, 0);

  return next;
}

export { FLORIDA_RULES as default };
