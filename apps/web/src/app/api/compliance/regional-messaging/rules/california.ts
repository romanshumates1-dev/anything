/**
 * California Regional Compliance Rules
 *
 * California has some of the strictest consumer protection laws in the US:
 *
 * CCPA (California Consumer Privacy Act):
 * - "Do Not Sell My Personal Information" disclosure required
 * - Right to know what data is collected
 * - Right to deletion
 * - Right to opt-out of sale
 *
 * CalDRE (California Department of Real Estate):
 * - Specific disclosures for wholesaling
 * - Anti-equity stripping laws for distressed properties
 *
 * Timing follows federal TCPA: 8am-9pm Pacific Time
 */

import type { RegionalRules } from '../types';
import { FEDERAL_RULES } from './federal';

export const CALIFORNIA_RULES: RegionalRules = {
  state: 'CA',
  timezone: 'America/Los_Angeles',

  quietHours: {
    sms: { startHour: 8, endHour: 21 }, // 8am-9pm PT
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
        ...(FEDERAL_RULES.disclosures.sms.realEstate || []),
        'CA: We may assign our contract to another buyer.',
      ],
      ccpa: [
        'CA Privacy Rights: {{ccpaUrl}}',
      ],
    },
    email: {
      required: [
        ...FEDERAL_RULES.disclosures.email.required,
      ],
      realEstate: [
        ...(FEDERAL_RULES.disclosures.email.realEstate || []),
        'California Notice: This communication is from a real estate investor who intends to assign or resell any contract entered into.',
      ],
      canSpam: [
        ...FEDERAL_RULES.disclosures.email.canSpam,
      ],
      ccpa: [
        'California residents: You have the right to know what personal information we collect.',
        'Do Not Sell My Personal Information: {{doNotSellUrl}}',
        'Privacy Policy: {{privacyUrl}}',
      ],
    },
    voice: {
      opener: [
        ...FEDERAL_RULES.disclosures.voice.opener,
      ],
      realEstate: [
        ...(FEDERAL_RULES.disclosures.voice.realEstate || []),
        'Under California law, I must disclose that I may assign any contract we sign to another investor.',
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
      cold: 'none', // CAN-SPAM opt-out model
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
    ccpa: '$2,500-$7,500 per intentional violation',
    calDre: 'License suspension/revocation for unlicensed activity',
  },

  additionalNotes: [
    'CCPA applies to businesses meeting certain thresholds',
    'CalDRE requires specific disclosures for wholesaling transactions',
    'Anti-equity stripping laws protect distressed homeowners',
    'Assignment contract disclosures required by CalDRE',
    'Three-day right of rescission for home solicitation sales',
  ],

  stateSpecific: {
    ccpaRequired: true,
    doNotSellRequired: true,
    distressedPropertyRules: {
      extendedCancellationPeriod: 5, // 5 business days
      equityPurchaseDisclosure: true,
      hudCounselingNotice: true,
    },
    // CalDRE may require earlier cutoff for distressed property communications
    distressedPropertyQuietHours: { endHour: 20 }, // 8PM for distressed properties
  },
};

/**
 * Get California-specific disclosures
 */
export function getCaliforniaDisclosures(
  channel: 'sms' | 'email' | 'voice',
  context: {
    businessName: string;
    physicalAddress?: string;
    unsubscribeUrl?: string;
    ccpaUrl?: string;
    doNotSellUrl?: string;
    privacyUrl?: string;
    isFirstMessage?: boolean;
    isRealEstate?: boolean;
    isDistressedProperty?: boolean;
  }
): string[] {
  const disclosures: string[] = [];
  const channelDisclosures = CALIFORNIA_RULES.disclosures[channel];

  if (!channelDisclosures) return disclosures;

  // Add standard disclosures
  if (channel === 'sms') {
    const smsDisclosures = channelDisclosures as typeof CALIFORNIA_RULES.disclosures.sms;
    if (context.isFirstMessage && smsDisclosures.firstMessage) {
      disclosures.push(...smsDisclosures.firstMessage);
    } else if (smsDisclosures.subsequent) {
      disclosures.push(...smsDisclosures.subsequent);
    }
    if (context.isRealEstate && smsDisclosures.realEstate) {
      disclosures.push(...smsDisclosures.realEstate);
    }
    if (smsDisclosures.ccpa) {
      disclosures.push(...smsDisclosures.ccpa);
    }
  }

  if (channel === 'email') {
    const emailDisclosures = channelDisclosures as typeof CALIFORNIA_RULES.disclosures.email;
    if (emailDisclosures.canSpam) {
      disclosures.push(...emailDisclosures.canSpam);
    }
    if (context.isRealEstate && emailDisclosures.realEstate) {
      disclosures.push(...emailDisclosures.realEstate);
    }
    if (emailDisclosures.ccpa) {
      disclosures.push(...emailDisclosures.ccpa);
    }
  }

  if (channel === 'voice') {
    const voiceDisclosures = channelDisclosures as typeof CALIFORNIA_RULES.disclosures.voice;
    if (voiceDisclosures.opener) {
      disclosures.push(...voiceDisclosures.opener);
    }
    if (context.isRealEstate && voiceDisclosures.realEstate) {
      disclosures.push(...voiceDisclosures.realEstate);
    }
  }

  // Add distressed property disclosures
  if (context.isDistressedProperty) {
    disclosures.push(
      'California Home Equity Sales Contract Act Notice: You have the right to cancel this contract within 5 business days.',
      'For free HUD-approved housing counseling, call 1-800-569-4287.'
    );
  }

  // Replace placeholders
  return disclosures.map((d) =>
    d
      .replace(/\{\{businessName\}\}/g, context.businessName)
      .replace(/\{\{physicalAddress\}\}/g, context.physicalAddress || '')
      .replace(/\{\{unsubscribeUrl\}\}/g, context.unsubscribeUrl || '')
      .replace(/\{\{ccpaUrl\}\}/g, context.ccpaUrl || '')
      .replace(/\{\{doNotSellUrl\}\}/g, context.doNotSellUrl || '')
      .replace(/\{\{privacyUrl\}\}/g, context.privacyUrl || '')
  );
}

/**
 * Generate CCPA-compliant email footer for California
 */
export function generateCcpaFooter(context: {
  businessName: string;
  physicalAddress: string;
  unsubscribeUrl: string;
  doNotSellUrl: string;
  privacyUrl: string;
}): string {
  return `
<div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-family: sans-serif; font-size: 11px; color: #64748b;">
  <p style="margin: 0 0 8px 0;">
    This message is from ${context.businessName}, a real estate investment company.
    We are not licensed real estate agents or brokers.
  </p>
  <p style="margin: 0 0 8px 0;">${context.physicalAddress}</p>
  <p style="margin: 0 0 8px 0;">
    <a href="${context.unsubscribeUrl}" style="color: #64748b;">Unsubscribe</a> |
    <a href="${context.privacyUrl}" style="color: #64748b;">Privacy Policy</a>
  </p>
  <p style="margin: 0 0 8px 0; padding: 8px; background: #f1f5f9; border-radius: 4px;">
    <strong>California Privacy Rights:</strong><br>
    <a href="${context.doNotSellUrl}" style="color: #64748b;">Do Not Sell My Personal Information</a><br>
    You have the right to know what personal information we collect and request its deletion.
  </p>
</div>`.trim();
}

export { CALIFORNIA_RULES as default };
