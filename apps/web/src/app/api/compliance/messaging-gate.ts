/**
 * Messaging Gate - Pre-send compliance check
 *
 * This is the unified entry point for all outbound message compliance checks.
 * It integrates the Regional Compliance Engine with the existing dispatchGate
 * to provide comprehensive pre-send validation.
 *
 * This gate should be called before any message is sent to ensure:
 * 1. Quiet hours are respected (state-specific and federal)
 * 2. Required disclosures are present
 * 3. DNC registry has been checked
 * 4. Consent requirements are met
 *
 * The gate can BLOCK a message (not allowed) or MODIFY it (add disclosures).
 */

import {
  detectRegion,
  loadRegionalRules,
  validateQuietHoursWithTimezone,
  injectDisclosures,
  checkDNC,
  calculateBestSendTime,
  getMultiTouchStatus,
} from './regional-messaging/engine';
import type {
  Channel,
  Recipient,
  DisclosureContext,
  MessageGateResult,
} from './regional-messaging/types';

export interface MessagingGateRequest {
  /** The message body to be sent */
  message: string;
  /** The recipient information */
  recipient: Recipient;
  /** The channel (sms, email, voice, rvm) */
  channel: Channel;
  /** Timestamp of when the message will be sent (defaults to now) */
  timestamp?: Date;
  /** Disclosure context for injecting required disclosures */
  context: DisclosureContext;
  /** Skip disclosure injection (for messages that already have them) */
  skipDisclosures?: boolean;
  /** Skip quiet hours check (for transactional messages) */
  skipQuietHours?: boolean;
  /** Skip DNC check (handled elsewhere, e.g., dispatchGate) */
  skipDncCheck?: boolean;
}

export interface MessagingGateResponse extends MessageGateResult {
  /** The region detected for the recipient */
  region?: {
    state: string;
    timezone: string;
  };
  /** Disclosures that were added to the message */
  disclosuresAdded?: string[];
  /** Warnings that don't block but should be noted */
  warnings?: string[];
  /** Compliance score (0-100) indicating how close to frequency limits */
  complianceScore?: number;
  /** Best send time recommendation for optimal engagement */
  bestSendTime?: {
    time: Date;
    reason: string;
    isOptimalWindow: boolean;
  };
  /** Multi-touch status for sequence tracking */
  multiTouch?: {
    touchesRemaining: number;
    optimalNextTouch: Date | null;
    recommendations: string[];
  };
}

/**
 * Main messaging gate check
 *
 * Call this before sending any message to ensure compliance with all
 * applicable federal and state regulations.
 *
 * Returns:
 * - allowed: true if the message can be sent
 * - message: the potentially modified message (with disclosures added)
 * - reason: why the message was blocked (if not allowed)
 * - retryAt: when the message can be retried (for quiet hours blocks)
 */
export async function check(
  request: MessagingGateRequest
): Promise<MessagingGateResponse> {
  const {
    message,
    recipient,
    channel,
    timestamp = new Date(),
    context,
    skipDisclosures = false,
    skipQuietHours = false,
    skipDncCheck = false,
  } = request;

  const warnings: string[] = [];
  const disclosuresAdded: string[] = [];

  // 1. Detect region
  const region = detectRegion(recipient.address, recipient.phone);
  const rules = loadRegionalRules(region.state);

  // 2. Check quiet hours (unless skipped for transactional messages)
  if (!skipQuietHours) {
    // Check for California distressed property stricter quiet hours (8pm vs 9pm)
    let effectiveEndHour: number | null = null;
    if (region.state === 'CA' && context.isDistressedProperty && rules.stateSpecific?.distressedPropertyQuietHours) {
      effectiveEndHour = rules.stateSpecific.distressedPropertyQuietHours.endHour;
    }

    const quietHoursResult = validateQuietHoursWithTimezone(
      region.state,
      channel,
      region.timezone,
      timestamp
    );

    // Additional check for distressed property stricter hours
    if (effectiveEndHour !== null && channel !== 'email') {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: region.timezone,
        hour: 'numeric',
        hour12: false,
      });
      const hourStr = formatter.format(timestamp);
      const hour = parseInt(hourStr, 10) === 24 ? 0 : parseInt(hourStr, 10);

      if (hour >= effectiveEndHour) {
        return {
          allowed: false,
          blocked: true,
          reason: `California distressed property communications: not allowed at or after ${effectiveEndHour > 12 ? effectiveEndHour - 12 : effectiveEndHour}:00 PM (CalDRE requirement)`,
          retryAt: quietHoursResult.nextAllowedTime,
          region: {
            state: region.state,
            timezone: region.timezone,
          },
        };
      }
    }

    if (!quietHoursResult.allowed) {
      return {
        allowed: false,
        blocked: true,
        reason: quietHoursResult.reason,
        retryAt: quietHoursResult.nextAllowedTime,
        region: {
          state: region.state,
          timezone: region.timezone,
        },
      };
    }
  }

  // 3. Check DNC registry (unless skipped)
  if (!skipDncCheck && channel !== 'email' && recipient.phone) {
    const dncResult = await checkDNC(recipient.phone, region.state);
    if (dncResult.onDnc) {
      return {
        allowed: false,
        blocked: true,
        reason: dncResult.reason || 'Phone is on Do-Not-Call registry',
        region: {
          state: region.state,
          timezone: region.timezone,
        },
      };
    }
  }

  // 3b. Check email suppression (internal opt-outs) for email channel
  // While email uses CAN-SPAM opt-out model, internal opt-out suppression must still be honored
  if (!skipDncCheck && channel === 'email' && recipient.email) {
    const sql = (await import('@/app/api/utils/sql')).default;
    const [emailOptOut] = await sql`
      SELECT 1 FROM compliance_records
      WHERE target = ${recipient.email}
      AND type = 'opt-out'
      LIMIT 1
    `.catch(() => [null]);

    if (emailOptOut) {
      return {
        allowed: false,
        blocked: true,
        reason: 'Recipient has opted out of email communications',
        region: {
          state: region.state,
          timezone: region.timezone,
        },
      };
    }
  }

  // 4. Inject required disclosures (unless skipped)
  let finalMessage = message;
  let modified = false;

  if (!skipDisclosures) {
    finalMessage = injectDisclosures(message, region.state, channel, context);

    if (finalMessage !== message) {
      modified = true;

      // Track what was added
      if (finalMessage.includes('Reply STOP') && !message.includes('Reply STOP')) {
        disclosuresAdded.push('SMS opt-out disclosure');
      }
      if (
        finalMessage.includes('real estate investor') &&
        !message.includes('real estate investor')
      ) {
        disclosuresAdded.push('Real estate investor disclosure');
      }
      if (finalMessage.includes('Msg frequency') && !message.includes('Msg frequency')) {
        disclosuresAdded.push('Message frequency disclosure');
      }
      if (finalMessage.includes(context.businessName) && !message.includes(context.businessName)) {
        disclosuresAdded.push('Business name identifier');
      }
    }
  }

  // 5. State-specific warnings
  if (region.state === 'CA') {
    if (context.isRealEstate && !context.doNotSellUrl) {
      warnings.push('California: Consider adding CCPA "Do Not Sell" link for email');
    }
  }

  if (region.state === 'FL') {
    // Florida has stricter timing (8pm vs 9pm)
    if (channel !== 'email') {
      warnings.push('Florida: Quiet hours end at 8pm (stricter than federal 9pm)');
    }
    // Florida requires written consent
    warnings.push('Florida: Ensure written consent is documented');
  }

  if (region.state === 'TX') {
    if (context.isRealEstate) {
      warnings.push('Texas: Ensure Texas Property Code disclosures are included');
    }
  }

  // 6. Check consent requirements
  const consentReq = rules.consentRequirements[channel as keyof typeof rules.consentRequirements];
  if (consentReq?.cold === 'prior_express_written') {
    warnings.push(`${region.state || 'Federal'}: Prior express written consent required for cold ${channel}`);
  }

  // 7. Calculate optimal send time and multi-touch status for revenue optimization
  const bestSendTimeResult = calculateBestSendTime(region.state, channel, timestamp);
  let multiTouchStatus = null;
  if (channel !== 'email' && recipient.phone) {
    try {
      multiTouchStatus = await getMultiTouchStatus(recipient.phone, channel, region.state);
    } catch (e) {
      // Non-fatal: multi-touch tracking is advisory
      console.warn('[MessagingGate] Multi-touch status unavailable:', e);
    }
  }

  return {
    allowed: true,
    message: finalMessage,
    modified,
    region: {
      state: region.state,
      timezone: region.timezone,
    },
    disclosuresAdded: disclosuresAdded.length > 0 ? disclosuresAdded : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
    complianceScore: multiTouchStatus?.complianceScore,
    bestSendTime: {
      time: bestSendTimeResult.bestTime,
      reason: bestSendTimeResult.reason,
      isOptimalWindow: bestSendTimeResult.isOptimalWindow,
    },
    multiTouch: multiTouchStatus ? {
      touchesRemaining: multiTouchStatus.touchesRemaining,
      optimalNextTouch: multiTouchStatus.optimalNextTouch,
      recommendations: multiTouchStatus.recommendations,
    } : undefined,
  };
}

/**
 * Quick check for quiet hours only
 *
 * Use this when you just need to know if it's within sending hours,
 * without the full validation pipeline.
 */
export function checkQuietHours(
  recipient: Recipient,
  channel: Channel,
  timestamp: Date = new Date()
): { allowed: boolean; reason?: string; retryAt?: Date } {
  const region = detectRegion(recipient.address, recipient.phone);
  const result = validateQuietHoursWithTimezone(region.state, channel, region.timezone, timestamp);

  return {
    allowed: result.allowed,
    reason: result.reason,
    retryAt: result.nextAllowedTime,
  };
}

/**
 * Get required disclosures for a channel and state
 *
 * Use this to display required disclosures in the UI or to
 * pre-populate message templates.
 */
export function getRequiredDisclosures(
  recipient: Recipient,
  channel: Channel,
  context: DisclosureContext
): string[] {
  const region = detectRegion(recipient.address, recipient.phone);
  const rules = loadRegionalRules(region.state);
  const disclosures: string[] = [];

  if (channel === 'sms') {
    const smsDisclosures = rules.disclosures.sms;
    if (context.isFirstMessage) {
      disclosures.push(...smsDisclosures.firstMessage);
    } else {
      disclosures.push(...smsDisclosures.subsequent);
    }
    if (context.isRealEstate && smsDisclosures.realEstate) {
      disclosures.push(...smsDisclosures.realEstate);
    }
  }

  if (channel === 'email') {
    const emailDisclosures = rules.disclosures.email;
    disclosures.push(...emailDisclosures.required);
    disclosures.push(...emailDisclosures.canSpam);
    if (context.isRealEstate && emailDisclosures.realEstate) {
      disclosures.push(...emailDisclosures.realEstate);
    }
  }

  // Replace placeholders
  return disclosures.map((d) =>
    d
      .replace(/\{\{businessName\}\}/g, context.businessName)
      .replace(/\{\{physicalAddress\}\}/g, context.physicalAddress || '[Physical Address Required]')
      .replace(/\{\{unsubscribeUrl\}\}/g, context.unsubscribeUrl || '[Unsubscribe URL Required]')
  );
}

/**
 * Generate a compliant email footer
 */
export function generateEmailFooter(
  recipient: Recipient,
  context: DisclosureContext & {
    unsubscribeUrl: string;
    privacyUrl: string;
  }
): string {
  const region = detectRegion(recipient.address, recipient.phone);

  let footer = `
<div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-family: sans-serif; font-size: 11px; color: #64748b;">
  <p style="margin: 0 0 8px 0;">
    This message is from ${context.businessName}, a real estate investment company.
    We are not licensed real estate agents or brokers unless otherwise stated.
  </p>
  <p style="margin: 0 0 8px 0;">${context.physicalAddress || '[Physical Address]'}</p>
  <p style="margin: 0 0 8px 0;">
    <a href="${context.unsubscribeUrl}" style="color: #64748b;">Unsubscribe</a> |
    <a href="${context.privacyUrl}" style="color: #64748b;">Privacy Policy</a>
  </p>`;

  // State-specific additions
  if (region.state === 'CA') {
    footer += `
  <p style="margin: 0 0 8px 0;">
    California residents: <a href="${context.doNotSellUrl || context.privacyUrl}" style="color: #64748b;">Do Not Sell My Personal Information</a>
  </p>`;
  }

  if (region.state === 'FL') {
    footer += `
  <p style="margin: 0 0 8px 0; padding: 8px; background: #fef3c7; border-radius: 4px; color: #92400e;">
    <strong>Florida Notice:</strong> You have a 3-day cooling off period for home solicitation sales.
  </p>`;
  }

  // Real estate disclosure
  if (context.isRealEstate) {
    footer += `
  <p style="margin: 0 0 8px 0; padding: 8px; background: #f1f5f9; border-radius: 4px;">
    This is a solicitation to purchase your property for investment purposes.
    We may assign any purchase contract to another investor.
  </p>`;
  }

  // Distressed property notice
  if (context.isDistressedProperty) {
    footer += `
  <p style="margin: 8px 0; padding: 8px; background: #fef3c7; border-radius: 4px; color: #92400e;">
    <strong>Important:</strong> You have the right to cancel this transaction.
    For free housing counseling, contact HUD at 1-800-569-4287.
  </p>`;
  }

  footer += '\n</div>';
  return footer.trim();
}

/**
 * Generate a compliant SMS message
 */
export function generateCompliantSms(
  recipient: Recipient,
  messageBody: string,
  context: DisclosureContext
): string {
  const region = detectRegion(recipient.address, recipient.phone);

  // Build the message
  let sms = '';

  // Add business name prefix for first messages
  if (context.isFirstMessage) {
    sms = `${context.businessName}: `;
  }

  // Add message body
  sms += messageBody;

  // Add disclosures
  const disclosures: string[] = [];

  // Always add opt-out
  if (!messageBody.toLowerCase().includes('stop to')) {
    disclosures.push('Reply STOP to unsubscribe.');
  }

  // Add frequency disclosure for first messages
  if (context.isFirstMessage) {
    disclosures.push('Msg frequency varies. Msg&data rates may apply.');
  }

  if (disclosures.length > 0) {
    sms += '\n\n' + disclosures.join(' ');
  }

  return sms;
}
