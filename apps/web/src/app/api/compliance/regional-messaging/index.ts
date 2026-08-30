/**
 * Regional Compliance Engine for Messaging
 *
 * This module provides comprehensive compliance checking for outbound messaging
 * in a real estate wholesaling pipeline. It handles:
 *
 * - Federal TCPA and CAN-SPAM regulations
 * - State-specific rules (CA, FL, TX, and generic fallback)
 * - Quiet hours validation
 * - Required disclosure injection
 * - DNC registry integration
 *
 * Usage:
 *
 * ```typescript
 * import {
 *   validateMessage,
 *   check,
 *   detectRegion,
 *   loadRegionalRules,
 * } from '@/app/api/compliance/regional-messaging';
 *
 * // Full validation
 * const result = await validateMessage(recipient, message, 'sms', {
 *   businessName: 'Acme Investments',
 *   isRealEstate: true,
 *   isFirstMessage: true,
 * });
 *
 * if (!result.allowed) {
 *   console.log('Message blocked:', result.reason);
 * } else {
 *   // Send result.modifiedMessage (includes required disclosures)
 * }
 *
 * // Quick quiet hours check
 * const quietHoursOk = checkQuietHours(recipient, 'sms');
 *
 * // Get region info
 * const region = detectRegion(recipient.address, recipient.phone);
 * const rules = loadRegionalRules(region.state);
 * ```
 */

// Main engine exports
export {
  detectRegion,
  loadRegionalRules,
  validateQuietHours,
  validateQuietHoursWithTimezone,
  injectDisclosures,
  checkDNC,
  validateMessage,
  getApplicableRules,
} from './engine';

// Type exports
export type {
  Channel,
  RegionInfo,
  RegionalRules,
  Recipient,
  QuietHoursResult,
  DncCheckResult,
  ValidationResult,
  DisclosureContext,
  ConsentType,
  FrequencyLimits,
  MessageGateResult,
} from './types';

// Rule set exports (for direct access)
export { FEDERAL_RULES } from './rules/federal';
export { CALIFORNIA_RULES } from './rules/california';
export { FLORIDA_RULES } from './rules/florida';
export { TEXAS_RULES } from './rules/texas';
export { GENERIC_RULES, hasStateSpecificRules, STATES_WITH_SPECIFIC_RULES } from './rules/generic';

// State-specific helper exports
export {
  validateFederalQuietHours,
  getFederalDisclosures,
} from './rules/federal';

export {
  getCaliforniaDisclosures,
  generateCcpaFooter,
} from './rules/california';

export {
  validateFloridaQuietHours,
  getFloridaDisclosures,
  generateFloridaFooter,
} from './rules/florida';

export {
  validateTexasQuietHours,
  getTexasDisclosures,
  generateTexasFooter,
  checkTexasRealEstateExemption,
} from './rules/texas';

export {
  validateGenericQuietHours,
  getGenericDisclosures,
  generateGenericFooter,
  generateGenericSmsFirstMessage,
  generateGenericSmsSubsequent,
} from './rules/generic';
