/**
 * Federal TCPA and CAN-SPAM Rules
 *
 * These are the baseline federal requirements that apply to all states.
 * State-specific rules may be stricter but never more lenient.
 *
 * TCPA (Telephone Consumer Protection Act):
 * - Quiet hours: 8am-9pm recipient local time
 * - Prior express consent required for auto-dialed calls/texts
 * - Maintain internal DNC list
 *
 * CAN-SPAM (Controlling the Assault of Non-Solicited Pornography And Marketing):
 * - Physical postal address required
 * - Unsubscribe mechanism required
 * - Honor opt-out within 10 business days
 * - Non-deceptive headers and subject lines
 */

import type { RegionalRules, Channel, QuietHoursResult } from '../types';

export const FEDERAL_RULES: RegionalRules = {
  state: 'FEDERAL',
  timezone: 'recipient_local', // Determined by recipient's location

  quietHours: {
    sms: { startHour: 8, endHour: 21 }, // 8am-9pm
    voice: { startHour: 8, endHour: 21 },
    rvm: { startHour: 8, endHour: 21 },
    email: null, // CAN-SPAM has no time restrictions for email
  },

  disclosures: {
    sms: {
      firstMessage: [
        '{{businessName}}: ',
        'Reply STOP to unsubscribe.',
        'Msg frequency varies. Msg&data rates may apply.',
      ],
      subsequent: ['Reply STOP to unsubscribe.'],
      realEstate: [
        'We are real estate investors, not licensed agents.',
        'This is a solicitation to purchase your property.',
      ],
    },
    email: {
      required: [
        '{{physicalAddress}}',
        'Unsubscribe: {{unsubscribeUrl}}',
      ],
      realEstate: [
        'This message is from {{businessName}}, a real estate investment company, not a licensed real estate agent or broker.',
        'This is a solicitation to purchase your property for investment purposes.',
      ],
      canSpam: [
        'This email was sent by {{businessName}}',
        '{{physicalAddress}}',
        'To stop receiving these emails: {{unsubscribeUrl}}',
      ],
    },
    voice: {
      opener: [
        'This is {{businessName}}.',
        'This call may be recorded for quality assurance.',
      ],
      realEstate: [
        'I am a real estate investor, not a licensed agent.',
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
      cold: 'none', // CAN-SPAM is opt-out, not opt-in
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
    tcpa: '$500-$1,500 per violation (treble for willful)',
    canSpam: 'Up to $50,120 per email violation',
  },

  additionalNotes: [
    'Prior express written consent required for marketing texts to cell phones',
    'Established business relationship does not exempt from TCPA cell phone rules',
    'Real estate solicitations have specific disclosure requirements',
    'Maintain internal DNC list for 5 years',
  ],
};

/**
 * Validate federal quiet hours
 */
export function validateFederalQuietHours(
  channel: Channel,
  recipientTimezone: string,
  timestamp: Date = new Date()
): QuietHoursResult {
  const hours = FEDERAL_RULES.quietHours[channel];

  // Email has no federal time restrictions
  if (!hours) {
    return { allowed: true };
  }

  // Get hour in recipient's timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: recipientTimezone,
    hour: 'numeric',
    hour12: false,
  });
  const hourStr = formatter.format(timestamp);
  const hour = parseInt(hourStr, 10) === 24 ? 0 : parseInt(hourStr, 10);

  if (hour < hours.startHour || hour >= hours.endHour) {
    return {
      allowed: false,
      reason: `TCPA quiet hours: sending not allowed before ${hours.startHour}:00 or after ${hours.endHour - 1}:59 recipient local time`,
      nextAllowedTime: calculateNextAllowed(hours.startHour, recipientTimezone, timestamp),
    };
  }

  return { allowed: true };
}

/**
 * Get federal disclosure text for a channel
 */
export function getFederalDisclosures(
  channel: Channel,
  context: {
    businessName: string;
    physicalAddress?: string;
    unsubscribeUrl?: string;
    isFirstMessage?: boolean;
    isRealEstate?: boolean;
  }
): string[] {
  const disclosures: string[] = [];
  const channelDisclosures = FEDERAL_RULES.disclosures[channel];

  if (!channelDisclosures) return disclosures;

  if (channel === 'sms') {
    const smsDisclosures = channelDisclosures as typeof FEDERAL_RULES.disclosures.sms;
    if (context.isFirstMessage && smsDisclosures.firstMessage) {
      disclosures.push(...smsDisclosures.firstMessage);
    } else if (smsDisclosures.subsequent) {
      disclosures.push(...smsDisclosures.subsequent);
    }
    if (context.isRealEstate && smsDisclosures.realEstate) {
      disclosures.push(...smsDisclosures.realEstate);
    }
  }

  if (channel === 'email') {
    const emailDisclosures = channelDisclosures as typeof FEDERAL_RULES.disclosures.email;
    if (emailDisclosures.canSpam) {
      disclosures.push(...emailDisclosures.canSpam);
    }
    if (context.isRealEstate && emailDisclosures.realEstate) {
      disclosures.push(...emailDisclosures.realEstate);
    }
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
 * Calculate next allowed send time
 */
function calculateNextAllowed(startHour: number, timezone: string, now: Date): Date {
  const next = new Date(now);

  // Get current hour in timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  });
  const currentHour = parseInt(formatter.format(now), 10);

  if (currentHour >= startHour) {
    // After start time, next allowed is tomorrow at startHour
    next.setDate(next.getDate() + 1);
  }

  // Set to startHour in the target timezone
  // This is an approximation - precise calculation would need timezone offset
  const tzOffset = getTimezoneOffset(timezone, next);
  next.setUTCHours(startHour + tzOffset / 60, 0, 0, 0);

  return next;
}

/**
 * Get timezone offset in minutes
 */
function getTimezoneOffset(timezone: string, date: Date): number {
  const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
  return (utcDate.getTime() - tzDate.getTime()) / 60000;
}

export { FEDERAL_RULES as default };
