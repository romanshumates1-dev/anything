/**
 * Campaign State Machine - Centralized State Transition Validation
 *
 * Defines all valid campaign state transitions and provides a single source
 * of truth for state validation across all campaign action routes.
 */

// All possible campaign states
export type CampaignStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'ACTIVE'
  | 'PAUSED'
  | 'COMPLETED'
  | 'CANCELLED';

// Centralized state transition table
// Each key is a source state, value is an array of valid target states
export const VALID_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  DRAFT: ['SCHEDULED', 'ACTIVE', 'CANCELLED'],
  SCHEDULED: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['PAUSED', 'COMPLETED', 'CANCELLED'],
  PAUSED: ['ACTIVE', 'COMPLETED', 'CANCELLED'],
  COMPLETED: [], // Terminal state - no outgoing transitions
  CANCELLED: [], // Terminal state - no outgoing transitions
};

// Terminal states that cannot transition to any other state
export const TERMINAL_STATES: CampaignStatus[] = ['COMPLETED', 'CANCELLED'];

/**
 * Validates whether a state transition is allowed
 *
 * @param fromState - Current state of the campaign
 * @param toState - Desired target state
 * @returns Object with isValid flag and error message if invalid
 */
export function validateTransition(
  fromState: string,
  toState: CampaignStatus
): { isValid: boolean; error?: string } {
  // Validate that fromState is a known state
  if (!(fromState in VALID_TRANSITIONS)) {
    return {
      isValid: false,
      error: `Unknown campaign state: ${fromState}`,
    };
  }

  const validTargets = VALID_TRANSITIONS[fromState as CampaignStatus];

  if (validTargets.includes(toState)) {
    return { isValid: true };
  }

  // Build helpful error message
  if (TERMINAL_STATES.includes(fromState as CampaignStatus)) {
    return {
      isValid: false,
      error: `Campaign is in terminal state: ${fromState}. No further transitions allowed.`,
    };
  }

  return {
    isValid: false,
    error: `Cannot transition campaign from ${fromState} to ${toState}. Valid transitions from ${fromState}: ${validTargets.length > 0 ? validTargets.join(', ') : 'none'}`,
  };
}

/**
 * Checks if a campaign is in a terminal state
 *
 * @param status - Current campaign status
 * @returns true if the campaign cannot transition to any other state
 */
export function isTerminalState(status: string): boolean {
  return TERMINAL_STATES.includes(status as CampaignStatus);
}

/**
 * Gets all valid target states from a given state
 *
 * @param fromState - Current campaign state
 * @returns Array of valid target states, or empty array if state is unknown
 */
export function getValidTargetStates(fromState: string): CampaignStatus[] {
  return VALID_TRANSITIONS[fromState as CampaignStatus] || [];
}
