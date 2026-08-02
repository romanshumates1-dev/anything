/**
 * Generic Regional Compliance Rules
 *
 * This provides the federal TCPA baseline for all states that don't have
 * state-specific rules defined. Uses federal standards as the floor.
 *
 * When a state is not in our specific rules registry, we fall back to:
 * - Federal TCPA quiet hours: 8am-9pm recipient local time
 * - Federal CAN-SPAM requirements for email
 * - Standard real estate investor disclosures
 */

import type { RegionalRules, Channel } from '../types';
import { FEDERAL_RULES, validateFederalQuietHours, getFederalDisclosures } from './federal';

/**
 * Generic rules that apply the federal baseline
 * These are used when no state-specific rules exist
 */
export const GENERIC_RULES: RegionalRules = {
  state: 'GENERIC',
  timezone: 'recipient_local', // Determined by recipient's location

  // Federal TCPA baseline: 8am-9pm recipient local time
  quietHours: {
    sms: { startHour: 8, endHour: 21 },
    voice: { startHour: 8, endHour: 21 },
    rvm: { startHour: 8, endHour: 21 },
    email: null, // CAN-SPAM has no time restrictions
  },

  disclosures: {
    sms: {
      firstMessage: [
        '{{businessName}}: ',
        'Reply STOP to unsubscribe.',
        'Msg frequency varies. Msg&data rates may apply.',
      ],
      subsequent: [
        'Reply STOP to unsubscribe.',
      ],
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
        'This message is from {{businessName}}, a real estate investment company.',
        'We are not licensed real estate agents or brokers.',
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
        'This call may be recorded.',
      ],
      realEstate: [
        'I am a real estate investor, not a licensed agent.',
        'I am interested in purchasing your property.',
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
      cold: 'none', // CAN-SPAM is opt-out
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
    'Federal TCPA baseline applies',
    'Check for state-specific rules that may be stricter',
    'Real estate disclosures required in all states',
    'Maintain internal DNC list for 5 years',
  ],
};

/**
 * Validate generic quiet hours (federal baseline)
 */
export function validateGenericQuietHours(
  channel: Channel,
  recipientTimezone: string,
  timestamp: Date = new Date()
): { allowed: boolean; reason?: string; nextAllowedTime?: Date } {
  // Delegate to federal rules
  return validateFederalQuietHours(channel, recipientTimezone, timestamp);
}

/**
 * Get generic disclosures (federal baseline)
 */
export function getGenericDisclosures(
  channel: Channel,
  context: {
    businessName: string;
    physicalAddress?: string;
    unsubscribeUrl?: string;
    isFirstMessage?: boolean;
    isRealEstate?: boolean;
  }
): string[] {
  // Delegate to federal rules
  return getFederalDisclosures(channel, context);
}

/**
 * Generate generic CAN-SPAM compliant email footer
 */
export function generateGenericFooter(context: {
  businessName: string;
  physicalAddress: string;
  unsubscribeUrl: string;
  privacyUrl?: string;
}): string {
  return `
<div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-family: sans-serif; font-size: 11px; color: #64748b;">
  <p style="margin: 0 0 8px 0;">
    This message is from ${context.businessName}, a real estate investment company.
    We are not licensed real estate agents or brokers unless otherwise stated.
  </p>
  <p style="margin: 0 0 8px 0;">${context.physicalAddress}</p>
  <p style="margin: 0 0 8px 0;">
    <a href="${context.unsubscribeUrl}" style="color: #64748b;">Unsubscribe</a>
    ${context.privacyUrl ? `| <a href="${context.privacyUrl}" style="color: #64748b;">Privacy Policy</a>` : ''}
  </p>
  <p style="margin: 0 0 8px 0; padding: 8px; background: #f1f5f9; border-radius: 4px;">
    This is a solicitation to purchase your property for investment purposes.
    We may assign any purchase contract to another investor.
  </p>
</div>`.trim();
}

/**
 * Generate generic SMS disclosure for first message
 */
export function generateGenericSmsFirstMessage(context: {
  businessName: string;
  messageBody: string;
}): string {
  const disclosures = [
    `${context.businessName}: `,
    context.messageBody,
    '\n\nReply STOP to unsubscribe. Msg frequency varies. Msg&data rates may apply.',
  ];
  return disclosures.join('');
}

/**
 * Generate generic SMS disclosure for subsequent messages
 */
export function generateGenericSmsSubsequent(context: {
  messageBody: string;
}): string {
  return `${context.messageBody}\n\nReply STOP to unsubscribe.`;
}

/**
 * List of states with known specific rules
 * For states not in this list, use generic/federal rules
 */
export const STATES_WITH_SPECIFIC_RULES = ['CA', 'FL', 'TX'] as const;
export type StateWithSpecificRules = (typeof STATES_WITH_SPECIFIC_RULES)[number];

/**
 * Check if a state has specific rules or should use generic
 */
export function hasStateSpecificRules(state: string): state is StateWithSpecificRules {
  return STATES_WITH_SPECIFIC_RULES.includes(state.toUpperCase() as StateWithSpecificRules);
}

export { GENERIC_RULES as default };
