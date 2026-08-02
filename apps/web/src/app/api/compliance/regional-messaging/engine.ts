/**
 * Regional Compliance Engine for Messaging
 *
 * This is the main compliance engine that validates messages against federal
 * and state-specific regulations before they are sent.
 *
 * Key functions:
 * - detectRegion: Determine recipient's state and timezone from address/phone
 * - loadRegionalRules: Get the applicable rules for a state
 * - validateQuietHours: Check if sending is allowed at the current time
 * - injectDisclosures: Add required legal disclosures to messages
 * - checkDNC: Do-Not-Call registry lookup
 * - validateMessage: Full validation pipeline
 */

import { areaCodeOf, regionForPhone, timezonesForPhone } from '@/app/api/utils/area-codes';
import type {
  Channel,
  RegionInfo,
  RegionalRules,
  Recipient,
  QuietHoursResult,
  DncCheckResult,
  ValidationResult,
  DisclosureContext,
} from './types';

// Import state-specific rules
import { FEDERAL_RULES } from './rules/federal';
import { CALIFORNIA_RULES } from './rules/california';
import { FLORIDA_RULES } from './rules/florida';
import { TEXAS_RULES } from './rules/texas';
import { GENERIC_RULES } from './rules/generic';

/**
 * State rules registry
 * Maps state codes to their specific rule sets
 */
const STATE_RULES_REGISTRY: Record<string, RegionalRules> = {
  CA: CALIFORNIA_RULES,
  FL: FLORIDA_RULES,
  TX: TEXAS_RULES,
};

/**
 * US state to timezone mapping for states without specific rules
 * This is a simplified mapping; some states span multiple timezones
 */
const STATE_TIMEZONE_MAP: Record<string, string> = {
  // Eastern Time
  CT: 'America/New_York', DE: 'America/New_York', GA: 'America/New_York',
  MA: 'America/New_York', MD: 'America/New_York', ME: 'America/New_York',
  NC: 'America/New_York', NH: 'America/New_York', NJ: 'America/New_York',
  NY: 'America/New_York', OH: 'America/New_York', PA: 'America/New_York',
  RI: 'America/New_York', SC: 'America/New_York', VA: 'America/New_York',
  VT: 'America/New_York', WV: 'America/New_York', DC: 'America/New_York',
  FL: 'America/New_York', // Most of Florida
  MI: 'America/New_York', // Most of Michigan
  IN: 'America/Indiana/Indianapolis',
  KY: 'America/New_York', // Most of Kentucky

  // Central Time
  AL: 'America/Chicago', AR: 'America/Chicago', IA: 'America/Chicago',
  IL: 'America/Chicago', KS: 'America/Chicago', LA: 'America/Chicago',
  MN: 'America/Chicago', MO: 'America/Chicago', MS: 'America/Chicago',
  OK: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago',
  WI: 'America/Chicago', NE: 'America/Chicago', SD: 'America/Chicago',
  ND: 'America/Chicago',

  // Mountain Time
  AZ: 'America/Phoenix', // No DST
  CO: 'America/Denver', MT: 'America/Denver', NM: 'America/Denver',
  UT: 'America/Denver', WY: 'America/Denver', ID: 'America/Denver',

  // Pacific Time
  CA: 'America/Los_Angeles', NV: 'America/Los_Angeles',
  OR: 'America/Los_Angeles', WA: 'America/Los_Angeles',

  // Alaska/Hawaii
  AK: 'America/Anchorage',
  HI: 'Pacific/Honolulu',
};

/**
 * Detect the region (state + timezone) from address and/or phone number
 *
 * Priority:
 * 1. Address state (most reliable)
 * 2. Phone area code lookup
 * 3. Default to generic/federal rules
 */
export function detectRegion(
  address?: { state?: string; zip?: string } | null,
  phone?: string | null
): RegionInfo {
  // Try address first (most reliable)
  if (address?.state) {
    const state = address.state.toUpperCase().trim();
    if (state.length === 2 && STATE_TIMEZONE_MAP[state]) {
      return {
        state,
        timezone: STATE_RULES_REGISTRY[state]?.timezone || STATE_TIMEZONE_MAP[state],
      };
    }
  }

  // Try phone area code
  if (phone) {
    const areaCode = areaCodeOf(phone);
    const geoPoint = regionForPhone(phone, true);

    if (geoPoint && areaCode) {
      // Extract state from region string (e.g., "Louisville, KY" -> "KY")
      const match = geoPoint.region.match(/,\s*([A-Z]{2})$/);
      const state = match ? match[1] : null;

      return {
        state: state || 'UNKNOWN',
        timezone: geoPoint.tz,
        areaCode,
      };
    }

    // Even if we don't know the state, we might know the timezone
    const timezones = timezonesForPhone(phone);
    if (timezones.length === 1) {
      return {
        state: 'UNKNOWN',
        timezone: timezones[0],
        areaCode: areaCode || undefined,
      };
    }
  }

  // Default to generic (will use most-restrictive approach)
  return {
    state: 'UNKNOWN',
    timezone: 'America/New_York', // Default to Eastern for safety
  };
}

/**
 * Load the regional rules for a given state
 *
 * Returns state-specific rules if available, otherwise generic/federal rules
 */
export function loadRegionalRules(state: string): RegionalRules {
  const upperState = state.toUpperCase().trim();

  // Check for state-specific rules
  if (STATE_RULES_REGISTRY[upperState]) {
    return STATE_RULES_REGISTRY[upperState];
  }

  // Return generic rules (federal baseline)
  return GENERIC_RULES;
}

/**
 * Validate quiet hours for a given state, channel, and timestamp
 *
 * Returns whether sending is allowed and the reason if not
 */
export function validateQuietHours(
  state: string,
  channel: Channel,
  timestamp: Date = new Date()
): QuietHoursResult {
  const rules = loadRegionalRules(state);
  const hours = rules.quietHours[channel];

  // Email has no quiet hours restrictions
  if (!hours) {
    return { allowed: true };
  }

  // Determine the timezone to check against
  let timezone = rules.timezone;
  if (timezone === 'recipient_local') {
    // For generic rules, we need the recipient's timezone
    // This should be passed in or determined from address/phone
    timezone = STATE_TIMEZONE_MAP[state.toUpperCase()] || 'America/New_York';
  }

  // Get hour in the recipient's timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  });
  const hourStr = formatter.format(timestamp);
  const hour = parseInt(hourStr, 10) === 24 ? 0 : parseInt(hourStr, 10);

  if (hour < hours.startHour || hour >= hours.endHour) {
    const stateName = rules.state === 'GENERIC' ? 'Federal TCPA' : `${rules.state} law`;
    const endDisplay = hours.endHour > 12 ? `${hours.endHour - 12}:00 PM` : `${hours.endHour}:00 AM`;

    return {
      allowed: false,
      reason: `${stateName}: sending not allowed before ${hours.startHour}:00 AM or after ${endDisplay} recipient local time`,
      nextAllowedTime: calculateNextAllowedTime(hours.startHour, timezone, timestamp),
    };
  }

  return { allowed: true };
}

/**
 * Validate quiet hours using timezone directly (for when timezone is already known)
 */
export function validateQuietHoursWithTimezone(
  state: string,
  channel: Channel,
  timezone: string,
  timestamp: Date = new Date()
): QuietHoursResult {
  const rules = loadRegionalRules(state);
  const hours = rules.quietHours[channel];

  // Email has no quiet hours restrictions
  if (!hours) {
    return { allowed: true };
  }

  // Get hour in the specified timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  });
  const hourStr = formatter.format(timestamp);
  const hour = parseInt(hourStr, 10) === 24 ? 0 : parseInt(hourStr, 10);

  if (hour < hours.startHour || hour >= hours.endHour) {
    const stateName = rules.state === 'GENERIC' ? 'Federal TCPA' : `${rules.state} law`;
    const endDisplay = hours.endHour > 12 ? `${hours.endHour - 12}:00 PM` : `${hours.endHour}:00 AM`;

    return {
      allowed: false,
      reason: `${stateName}: sending not allowed before ${hours.startHour}:00 AM or after ${endDisplay} recipient local time`,
      nextAllowedTime: calculateNextAllowedTime(hours.startHour, timezone, timestamp),
    };
  }

  return { allowed: true };
}

/**
 * Inject required disclosures into a message
 *
 * Modifies the message to include all required legal disclosures for the
 * recipient's state and the channel being used.
 */
export function injectDisclosures(
  message: string,
  state: string,
  channel: Channel,
  context: DisclosureContext
): string {
  const rules = loadRegionalRules(state);
  const disclosures: string[] = [];

  // Get channel-specific disclosures
  if (channel === 'sms') {
    const smsDisclosures = rules.disclosures.sms;
    if (context.isFirstMessage && smsDisclosures.firstMessage) {
      // Prepend business name
      const prefix = smsDisclosures.firstMessage[0] || '';
      if (prefix && !message.startsWith(context.businessName)) {
        message = prefix.replace('{{businessName}}', context.businessName) + message;
      }
    }

    // Add opt-out disclosure if not present
    const optOutPattern = /reply stop|text stop|unsubscribe/i;
    if (!optOutPattern.test(message)) {
      disclosures.push('Reply STOP to unsubscribe.');
    }

    // Add real estate disclosures
    if (context.isRealEstate && smsDisclosures.realEstate) {
      // Check if disclosures already present
      const reInvestorPattern = /real estate investor|not.*(licensed|agent)/i;
      if (!reInvestorPattern.test(message)) {
        disclosures.push(...smsDisclosures.realEstate);
      }
    }

    // Add first-message frequency disclosure
    if (context.isFirstMessage) {
      const freqPattern = /msg.*frequency|message.*rate/i;
      if (!freqPattern.test(message)) {
        disclosures.push('Msg frequency varies. Msg&data rates may apply.');
      }
    }
  }

  if (channel === 'email') {
    // Email disclosures are typically in the footer, handled separately
    // But we can add inline disclosures if needed
    if (context.isRealEstate) {
      const rePattern = /real estate investor|not.*licensed.*agent/i;
      if (!rePattern.test(message)) {
        disclosures.push(
          'This message is from a real estate investment company, not a licensed real estate agent or broker.'
        );
      }
    }
  }

  // Replace placeholders in disclosures
  const processedDisclosures = disclosures.map((d) =>
    d
      .replace(/\{\{businessName\}\}/g, context.businessName)
      .replace(/\{\{physicalAddress\}\}/g, context.physicalAddress || '')
      .replace(/\{\{unsubscribeUrl\}\}/g, context.unsubscribeUrl || '')
  );

  // Append disclosures to message
  if (processedDisclosures.length > 0) {
    if (channel === 'sms') {
      // SMS: append with newlines
      message = message.trim() + '\n\n' + processedDisclosures.join(' ');
    } else if (channel === 'email') {
      // Email: append at the end
      message = message + '\n\n' + processedDisclosures.join('\n');
    }
  }

  return message;
}

/**
 * Check if a phone number is on the Do-Not-Call registry
 *
 * This is a stub that will integrate with the actual DNC registry lookup.
 * Currently delegates to the existing dncRegistry module.
 */
export async function checkDNC(
  phone: string,
  state?: string
): Promise<DncCheckResult> {
  try {
    const { checkDncRegistry } = await import('@/app/api/utils/dncRegistry');
    const result = await checkDncRegistry(phone);

    if (result.listed) {
      return {
        onDnc: true,
        source: result.source,
        jurisdiction: result.jurisdiction,
        reason: `Phone is on the ${result.source}${result.jurisdiction ? `/${result.jurisdiction}` : ''} Do-Not-Call registry`,
      };
    }

    return { onDnc: false };
  } catch (error) {
    // Log but don't fail - DNC check errors should not block sends
    // The dispatchGate has its own DNC checking that is authoritative
    console.error('[RegionalComplianceEngine] DNC check error:', error);
    return { onDnc: false };
  }
}

/**
 * Full message validation pipeline
 *
 * Validates a message against all applicable rules for the recipient's region
 * and channel. Returns whether the message is allowed to be sent, and if so,
 * the potentially modified message with required disclosures.
 */
export async function validateMessage(
  recipient: Recipient,
  message: string,
  channel: Channel,
  context: DisclosureContext & { timestamp?: Date }
): Promise<ValidationResult> {
  const violations: string[] = [];
  const warnings: string[] = [];
  const disclosuresAdded: string[] = [];

  // Detect region
  const region = detectRegion(recipient.address, recipient.phone);
  const rules = loadRegionalRules(region.state);

  // 1. Check quiet hours
  const quietHoursResult = validateQuietHoursWithTimezone(
    region.state,
    channel,
    region.timezone,
    context.timestamp || new Date()
  );

  if (!quietHoursResult.allowed) {
    return {
      allowed: false,
      reason: quietHoursResult.reason,
      violations: [quietHoursResult.reason || 'Outside quiet hours'],
      nextAllowedTime: quietHoursResult.nextAllowedTime,
    };
  }

  // 2. Check DNC (for telephony channels)
  if (channel !== 'email' && recipient.phone) {
    const dncResult = await checkDNC(recipient.phone, region.state);
    if (dncResult.onDnc) {
      return {
        allowed: false,
        reason: dncResult.reason,
        violations: [dncResult.reason || 'Phone is on Do-Not-Call registry'],
      };
    }
  }

  // 3. Inject required disclosures
  let modifiedMessage = injectDisclosures(message, region.state, channel, context);

  // Track what disclosures were added
  if (modifiedMessage !== message) {
    if (modifiedMessage.includes('Reply STOP')) {
      disclosuresAdded.push('SMS opt-out disclosure');
    }
    if (modifiedMessage.includes('real estate investor')) {
      disclosuresAdded.push('Real estate investor disclosure');
    }
    if (modifiedMessage.includes('Msg frequency')) {
      disclosuresAdded.push('Message frequency disclosure');
    }
  }

  // 4. Check for state-specific requirements
  if (region.state === 'CA' && context.isRealEstate) {
    // CCPA requirements
    if (channel === 'email' && !context.doNotSellUrl) {
      warnings.push('California: Consider adding "Do Not Sell My Personal Information" link');
    }
  }

  if (region.state === 'FL') {
    // Florida has stricter consent requirements
    if (channel !== 'email') {
      warnings.push('Florida: Written consent required for telemarketing');
    }
  }

  // 5. Validate message content
  // Check for prohibited patterns
  const prohibitedPatterns = [
    { pattern: /guarantee.*price/i, message: 'Avoid guaranteeing specific prices' },
    { pattern: /stop.*foreclosure/i, message: 'Avoid absolute promises about stopping foreclosure' },
    { pattern: /licensed.*agent/i, message: 'Only claim license if actually licensed' },
  ];

  for (const { pattern, message: warning } of prohibitedPatterns) {
    if (pattern.test(modifiedMessage) && pattern.test(message)) {
      warnings.push(warning);
    }
  }

  return {
    allowed: true,
    modifiedMessage,
    violations: violations.length > 0 ? violations : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
    disclosuresAdded: disclosuresAdded.length > 0 ? disclosuresAdded : undefined,
  };
}

/**
 * Get all applicable rules for a recipient
 * Useful for displaying compliance information in the UI
 */
export function getApplicableRules(recipient: Recipient): {
  federal: RegionalRules;
  state: RegionalRules | null;
  region: RegionInfo;
} {
  const region = detectRegion(recipient.address, recipient.phone);
  const stateRules = STATE_RULES_REGISTRY[region.state] || null;

  return {
    federal: FEDERAL_RULES,
    state: stateRules,
    region,
  };
}

/**
 * Calculate the next allowed send time
 */
function calculateNextAllowedTime(
  startHour: number,
  timezone: string,
  now: Date
): Date {
  const next = new Date(now);

  // Get current hour in the target timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  });
  const currentHour = parseInt(formatter.format(now), 10);

  if (currentHour >= startHour) {
    // After start time, next allowed is tomorrow
    next.setDate(next.getDate() + 1);
  }

  // Calculate timezone offset
  const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
  const tzDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  const offsetMinutes = (utcDate.getTime() - tzDate.getTime()) / 60000;

  // Set to startHour in the target timezone
  next.setUTCHours(startHour + offsetMinutes / 60, 0, 0, 0);

  return next;
}

// Re-export types
export * from './types';

// Re-export rules for direct access
export { FEDERAL_RULES, CALIFORNIA_RULES, FLORIDA_RULES, TEXAS_RULES, GENERIC_RULES };
