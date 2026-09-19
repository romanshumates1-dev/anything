/**
 * Campaign Builder - 10-Step Campaign Configuration System
 *
 * Provides structured campaign configuration with validation, cost estimation,
 * and type-safe interfaces for the multi-step campaign builder UI.
 *
 * Steps:
 * 1. Objective - Define campaign goal (deals/leads/appointments)
 * 2. Lead Source - Import, finder, or existing leads
 * 3. Qualification - Scoring and filtering criteria
 * 4. Channels - Phone, SMS, email selection
 * 5. Sequence - Multi-touch outreach phases
 * 6. AI Messaging - Tone and personalization
 * 7. Timing - Send windows and frequency
 * 8. Budget - Credit and spending limits
 * 9. Review - Summary and validation (handled by UI)
 * 10. Launch - Activation (handled by UI)
 *
 * @module campaignBuilder
 * @version 2.0.0
 */

// ============================================================================
// Types & Interfaces
// ============================================================================

/**
 * Step 1: Campaign Objective
 * Defines what the campaign is trying to achieve
 */
export interface CampaignObjective {
  type: 'deals' | 'leads' | 'appointments';
  target: number; // Target number of conversions
  market: string; // Geographic market/region
  budget?: number; // Optional budget in cents
}

/**
 * Step 2: Lead Source Configuration
 * Where the leads for this campaign come from
 */
export interface LeadSourceConfig {
  type: 'import' | 'finder' | 'existing';
  criteria?: Record<string, unknown>; // Search criteria for finder
  listId?: string; // ID of existing list to use
  importFile?: string; // File reference for imports
  count?: number; // Estimated lead count
}

/**
 * Step 3: Qualification Settings
 * How leads are scored and filtered
 */
export interface QualificationConfig {
  enabled: boolean;
  scoring: boolean;
  minScore?: number; // 0-100, minimum score to include
  filters: {
    propertyTypes?: string[]; // 'single_family', 'multi_family', 'condo', etc.
    minEquity?: number; // Minimum equity percentage
    maxAge?: number; // Maximum days since lead created
    distressIndicators?: string[]; // 'pre_foreclosure', 'tax_lien', 'vacant', etc.
    priceRange?: { min: number; max: number }; // In cents
    ownershipDuration?: { min?: number; max?: number }; // Years
  };
}

/**
 * Step 4: Channel Configuration
 * Which communication channels to use
 */
export interface ChannelConfig {
  phone: boolean;
  sms: boolean;
  email: boolean;
  voicemail?: boolean; // Ringless voicemail
  directMail?: boolean; // Physical mail
}

/**
 * Step 5: Campaign Phase/Sequence
 * Individual step in the outreach sequence
 */
export interface CampaignPhase {
  id: string;
  order: number;
  channel: 'phone' | 'sms' | 'email' | 'voicemail' | 'directMail';
  enabled: boolean;
  delay: number; // Hours after previous phase
  template?: string; // Template ID or content
  templateName?: string; // Human-readable template name
  useAI: boolean; // Use AI to personalize
  retryOnFail: boolean; // Retry if delivery fails
  maxRetries?: number;
  conditions?: PhaseCondition[]; // Skip conditions
}

/**
 * Conditions for skipping a phase
 */
export interface PhaseCondition {
  type: 'response_received' | 'status_changed' | 'score_above' | 'time_elapsed';
  value: string | number;
  action: 'skip' | 'stop' | 'branch';
}

/**
 * Step 6: AI Messaging Configuration
 * How AI personalizes messages
 */
export interface AIMessagingConfig {
  enabled: boolean;
  tone?: 'professional' | 'friendly' | 'urgent' | 'empathetic' | 'casual';
  customPrompt?: string; // Custom instructions for AI
  personalizationLevel?: 'low' | 'medium' | 'high';
  includePropertyDetails?: boolean;
  includeMarketData?: boolean;
  useAbTesting?: boolean;
}

/**
 * Step 7: Timing Configuration
 * When and how often to send
 */
export interface TimingConfig {
  sendingWindows: {
    start: string; // "09:00"
    end: string; // "17:00"
    days: number[]; // 0=Sunday, 1=Monday, etc.
    timezone?: string; // IANA timezone
  };
  delays: {
    min: number; // Minimum hours between contacts
    max: number; // Maximum hours between contacts
  };
  dailyCap: number; // Max contacts per day
  contactFrequency: number; // Minimum days between contacting same lead
  respectDoNotDisturb?: boolean;
  pauseOnHolidays?: boolean;
}

/**
 * Step 8: Budget Configuration
 * Spending limits and alerts
 */
export interface BudgetConfig {
  maxCredits: number; // Maximum credits to spend
  maxProviderSpend: number; // Maximum $ to external providers
  warningThreshold: number; // Alert when this % spent (0-100)
  dailyLimit?: number; // Max credits per day
  pauseOnLimit?: boolean; // Pause campaign when limit reached
}

/**
 * Complete Campaign Configuration
 * Combines all 8 configuration steps
 */
export interface CampaignConfig {
  // Step 1: Objective
  objective: CampaignObjective;

  // Step 2: Lead Source
  leadSource: LeadSourceConfig;

  // Step 3: Qualification
  qualification: QualificationConfig;

  // Step 4: Channels
  channels: ChannelConfig;

  // Step 5: Sequence
  sequence: CampaignPhase[];

  // Step 6: AI Messaging
  aiMessaging: AIMessagingConfig;

  // Step 7: Timing
  timing: TimingConfig;

  // Step 8: Budget
  budget: BudgetConfig;

  // Metadata
  name?: string;
  description?: string;
  tags?: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Validation result for campaign config
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  step: number;
  field: string;
  message: string;
  code: string;
}

export interface ValidationWarning {
  step: number;
  field: string;
  message: string;
  suggestion?: string;
}

/**
 * Cost estimation result
 */
export interface CostEstimate {
  credits: number;
  providerCost: number; // In cents
  breakdown: Record<string, number>;
  perLead: number;
  projectedROI?: number;
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate the complete campaign configuration
 */
export function validateCampaignConfig(config: CampaignConfig): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Step 1: Objective validation
  if (!config.objective?.type) {
    errors.push({
      step: 1,
      field: 'objective.type',
      message: 'Objective type is required',
      code: 'OBJECTIVE_TYPE_REQUIRED',
    });
  }
  if (!config.objective?.target || config.objective.target <= 0) {
    errors.push({
      step: 1,
      field: 'objective.target',
      message: 'Target must be a positive number',
      code: 'OBJECTIVE_TARGET_INVALID',
    });
  }
  if (!config.objective?.market?.trim()) {
    errors.push({
      step: 1,
      field: 'objective.market',
      message: 'Market/region is required',
      code: 'OBJECTIVE_MARKET_REQUIRED',
    });
  }

  // Step 2: Lead Source validation
  if (!config.leadSource?.type) {
    errors.push({
      step: 2,
      field: 'leadSource.type',
      message: 'Lead source type is required',
      code: 'LEAD_SOURCE_TYPE_REQUIRED',
    });
  }
  if (config.leadSource?.type === 'existing' && !config.leadSource.listId) {
    errors.push({
      step: 2,
      field: 'leadSource.listId',
      message: 'List ID is required when using existing leads',
      code: 'LEAD_SOURCE_LIST_REQUIRED',
    });
  }
  if (config.leadSource?.type === 'finder' && !config.leadSource.criteria) {
    warnings.push({
      step: 2,
      field: 'leadSource.criteria',
      message: 'No search criteria specified for lead finder',
      suggestion: 'Add criteria to target specific leads',
    });
  }

  // Step 3: Qualification validation
  if (config.qualification?.enabled && config.qualification.scoring) {
    if (config.qualification.minScore !== undefined) {
      if (config.qualification.minScore < 0 || config.qualification.minScore > 100) {
        errors.push({
          step: 3,
          field: 'qualification.minScore',
          message: 'Minimum score must be between 0 and 100',
          code: 'QUALIFICATION_SCORE_INVALID',
        });
      }
    }
  }
  if (config.qualification?.filters?.minEquity !== undefined) {
    if (config.qualification.filters.minEquity < 0 || config.qualification.filters.minEquity > 100) {
      errors.push({
        step: 3,
        field: 'qualification.filters.minEquity',
        message: 'Minimum equity must be between 0 and 100',
        code: 'QUALIFICATION_EQUITY_INVALID',
      });
    }
  }

  // Step 4: Channels validation
  if (!config.channels?.phone && !config.channels?.sms && !config.channels?.email) {
    errors.push({
      step: 4,
      field: 'channels',
      message: 'At least one channel must be enabled',
      code: 'CHANNELS_NONE_ENABLED',
    });
  }
  if (config.channels?.phone && !config.channels?.sms) {
    warnings.push({
      step: 4,
      field: 'channels',
      message: 'Phone without SMS may limit automation capabilities',
      suggestion: 'Consider enabling SMS for follow-ups',
    });
  }

  // Step 5: Sequence validation
  if (!config.sequence?.length) {
    errors.push({
      step: 5,
      field: 'sequence',
      message: 'At least one sequence phase is required',
      code: 'SEQUENCE_EMPTY',
    });
  } else {
    const enabledPhases = config.sequence.filter((p) => p.enabled);
    if (enabledPhases.length === 0) {
      errors.push({
        step: 5,
        field: 'sequence',
        message: 'At least one sequence phase must be enabled',
        code: 'SEQUENCE_NONE_ENABLED',
      });
    }

    // Validate each phase
    for (const phase of config.sequence) {
      if (phase.enabled) {
        // Check channel is enabled
        const channelEnabled =
          (phase.channel === 'phone' && config.channels?.phone) ||
          (phase.channel === 'sms' && config.channels?.sms) ||
          (phase.channel === 'email' && config.channels?.email) ||
          (phase.channel === 'voicemail' && config.channels?.voicemail) ||
          (phase.channel === 'directMail' && config.channels?.directMail);

        if (!channelEnabled) {
          errors.push({
            step: 5,
            field: `sequence[${phase.order}].channel`,
            message: `Phase ${phase.order + 1} uses ${phase.channel} but that channel is not enabled`,
            code: 'SEQUENCE_CHANNEL_DISABLED',
          });
        }

        // Check template exists for non-phone channels
        if (phase.channel !== 'phone' && !phase.template && !phase.useAI) {
          errors.push({
            step: 5,
            field: `sequence[${phase.order}].template`,
            message: `Phase ${phase.order + 1} requires a template or AI messaging`,
            code: 'SEQUENCE_TEMPLATE_REQUIRED',
          });
        }

        // Validate delay
        if (phase.order > 0 && phase.delay < 0) {
          errors.push({
            step: 5,
            field: `sequence[${phase.order}].delay`,
            message: `Phase ${phase.order + 1} delay cannot be negative`,
            code: 'SEQUENCE_DELAY_INVALID',
          });
        }
      }
    }

    // Warning for too many phases
    if (enabledPhases.length > 7) {
      warnings.push({
        step: 5,
        field: 'sequence',
        message: 'More than 7 touch points may reduce response rates',
        suggestion: 'Consider limiting to 5-7 touches for best results',
      });
    }
  }

  // Step 6: AI Messaging validation
  if (config.aiMessaging?.enabled) {
    if (config.aiMessaging.customPrompt && config.aiMessaging.customPrompt.length > 1000) {
      errors.push({
        step: 6,
        field: 'aiMessaging.customPrompt',
        message: 'Custom prompt cannot exceed 1000 characters',
        code: 'AI_PROMPT_TOO_LONG',
      });
    }
  }

  // Step 7: Timing validation
  if (!config.timing?.sendingWindows) {
    errors.push({
      step: 7,
      field: 'timing.sendingWindows',
      message: 'Sending window configuration is required',
      code: 'TIMING_WINDOW_REQUIRED',
    });
  } else {
    const { start, end, days } = config.timing.sendingWindows;

    // Validate time format
    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (!timeRegex.test(start)) {
      errors.push({
        step: 7,
        field: 'timing.sendingWindows.start',
        message: 'Start time must be in HH:MM format',
        code: 'TIMING_START_INVALID',
      });
    }
    if (!timeRegex.test(end)) {
      errors.push({
        step: 7,
        field: 'timing.sendingWindows.end',
        message: 'End time must be in HH:MM format',
        code: 'TIMING_END_INVALID',
      });
    }

    // Validate days
    if (!days?.length) {
      errors.push({
        step: 7,
        field: 'timing.sendingWindows.days',
        message: 'At least one send day must be selected',
        code: 'TIMING_DAYS_REQUIRED',
      });
    } else {
      for (const day of days) {
        if (day < 0 || day > 6) {
          errors.push({
            step: 7,
            field: 'timing.sendingWindows.days',
            message: 'Days must be 0-6 (Sunday-Saturday)',
            code: 'TIMING_DAY_INVALID',
          });
          break;
        }
      }
    }

    // Warning for weekend sends
    if (days?.includes(0) || days?.includes(6)) {
      warnings.push({
        step: 7,
        field: 'timing.sendingWindows.days',
        message: 'Weekend sends may have lower response rates',
        suggestion: 'Consider focusing on weekday outreach',
      });
    }
  }

  if (config.timing?.dailyCap !== undefined && config.timing.dailyCap <= 0) {
    errors.push({
      step: 7,
      field: 'timing.dailyCap',
      message: 'Daily cap must be a positive number',
      code: 'TIMING_CAP_INVALID',
    });
  }

  if (config.timing?.contactFrequency !== undefined && config.timing.contactFrequency < 0) {
    errors.push({
      step: 7,
      field: 'timing.contactFrequency',
      message: 'Contact frequency cannot be negative',
      code: 'TIMING_FREQUENCY_INVALID',
    });
  }

  // Step 8: Budget validation
  if (config.budget?.maxCredits !== undefined && config.budget.maxCredits < 0) {
    errors.push({
      step: 8,
      field: 'budget.maxCredits',
      message: 'Maximum credits cannot be negative',
      code: 'BUDGET_CREDITS_INVALID',
    });
  }
  if (config.budget?.maxProviderSpend !== undefined && config.budget.maxProviderSpend < 0) {
    errors.push({
      step: 8,
      field: 'budget.maxProviderSpend',
      message: 'Maximum provider spend cannot be negative',
      code: 'BUDGET_SPEND_INVALID',
    });
  }
  if (config.budget?.warningThreshold !== undefined) {
    if (config.budget.warningThreshold < 0 || config.budget.warningThreshold > 100) {
      errors.push({
        step: 8,
        field: 'budget.warningThreshold',
        message: 'Warning threshold must be between 0 and 100',
        code: 'BUDGET_THRESHOLD_INVALID',
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate a single step of the configuration
 */
export function validateStep(
  step: number,
  config: Partial<CampaignConfig>
): { valid: boolean; errors: ValidationError[]; warnings: ValidationWarning[] } {
  // Create a full config with defaults for validation
  const fullConfig = createDefaultConfig();
  Object.assign(fullConfig, config);

  const result = validateCampaignConfig(fullConfig);

  // Filter to only this step
  return {
    valid: result.errors.filter((e) => e.step === step).length === 0,
    errors: result.errors.filter((e) => e.step === step),
    warnings: result.warnings.filter((w) => w.step === step),
  };
}

// ============================================================================
// Cost Estimation Functions
// ============================================================================

/**
 * Cost per channel (in credits)
 */
const CHANNEL_COSTS: Record<string, number> = {
  phone: 10, // Call costs more
  sms: 1, // SMS is cheap
  email: 0.1, // Email is cheapest
  voicemail: 3, // Ringless VM
  directMail: 50, // Physical mail
};

/**
 * AI personalization cost multiplier
 */
const AI_COST_MULTIPLIER = 1.2; // 20% more for AI personalization

/**
 * Provider cost per credit (in cents)
 */
const PROVIDER_COST_PER_CREDIT = 2; // $0.02 per credit

/**
 * Estimate the cost of running a campaign
 */
export function estimateCampaignCost(
  config: CampaignConfig,
  leadCount: number
): CostEstimate {
  let credits = 0;
  const breakdown: Record<string, number> = {};

  // Calculate cost for each enabled phase
  for (const phase of config.sequence) {
    if (!phase.enabled) continue;

    const baseCost = CHANNEL_COSTS[phase.channel] || 1;
    let phaseCost = baseCost * leadCount;

    // Apply AI multiplier if using AI
    if (phase.useAI && config.aiMessaging?.enabled) {
      phaseCost *= AI_COST_MULTIPLIER;
    }

    // Account for retries
    if (phase.retryOnFail) {
      phaseCost *= 1.1; // Assume 10% retry rate
    }

    credits += phaseCost;
    breakdown[phase.channel] = (breakdown[phase.channel] || 0) + phaseCost;
  }

  // Apply qualification filter estimate (reduces actual contacts)
  if (config.qualification?.enabled) {
    const filterRate = config.qualification.scoring ? 0.7 : 0.85; // Scoring filters more
    credits *= filterRate;
    for (const key of Object.keys(breakdown)) {
      breakdown[key] *= filterRate;
    }
  }

  // Round credits
  credits = Math.ceil(credits);
  for (const key of Object.keys(breakdown)) {
    breakdown[key] = Math.ceil(breakdown[key]);
  }

  // Calculate provider cost
  const providerCost = credits * PROVIDER_COST_PER_CREDIT;

  // Calculate per-lead cost
  const perLead = leadCount > 0 ? credits / leadCount : 0;

  // Estimate ROI based on objective
  let projectedROI: number | undefined;
  if (config.objective?.type === 'deals' && config.objective.target > 0) {
    // Assume average deal profit of $10,000
    const avgDealProfit = 1000000; // cents
    const conversionRate = 0.02; // 2% conversion estimate
    const expectedDeals = Math.floor(leadCount * conversionRate);
    const expectedProfit = expectedDeals * avgDealProfit;
    const totalCost = providerCost + (config.budget?.maxProviderSpend || 0);
    if (totalCost > 0) {
      projectedROI = ((expectedProfit - totalCost) / totalCost) * 100;
    }
  }

  return {
    credits,
    providerCost,
    breakdown,
    perLead: Math.round(perLead * 100) / 100,
    projectedROI: projectedROI ? Math.round(projectedROI) : undefined,
  };
}

/**
 * Estimate cost for a single phase
 */
export function estimatePhaseCost(
  phase: CampaignPhase,
  leadCount: number,
  aiEnabled: boolean
): { credits: number; providerCost: number } {
  if (!phase.enabled) return { credits: 0, providerCost: 0 };

  const baseCost = CHANNEL_COSTS[phase.channel] || 1;
  let credits = baseCost * leadCount;

  if (phase.useAI && aiEnabled) {
    credits *= AI_COST_MULTIPLIER;
  }

  if (phase.retryOnFail) {
    credits *= 1.1;
  }

  credits = Math.ceil(credits);

  return {
    credits,
    providerCost: credits * PROVIDER_COST_PER_CREDIT,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a default campaign configuration
 */
export function createDefaultConfig(): CampaignConfig {
  return {
    objective: {
      type: 'deals',
      target: 10,
      market: '',
    },
    leadSource: {
      type: 'existing',
    },
    qualification: {
      enabled: true,
      scoring: true,
      minScore: 50,
      filters: {
        propertyTypes: ['single_family'],
        distressIndicators: [],
      },
    },
    channels: {
      phone: false,
      sms: true,
      email: true,
    },
    sequence: [
      {
        id: crypto.randomUUID(),
        order: 0,
        channel: 'sms',
        enabled: true,
        delay: 0,
        useAI: true,
        retryOnFail: true,
      },
      {
        id: crypto.randomUUID(),
        order: 1,
        channel: 'email',
        enabled: true,
        delay: 48, // 2 days
        useAI: true,
        retryOnFail: true,
      },
      {
        id: crypto.randomUUID(),
        order: 2,
        channel: 'sms',
        enabled: true,
        delay: 120, // 5 days
        useAI: true,
        retryOnFail: true,
      },
    ],
    aiMessaging: {
      enabled: true,
      tone: 'professional',
      personalizationLevel: 'high',
      includePropertyDetails: true,
    },
    timing: {
      sendingWindows: {
        start: '09:00',
        end: '17:00',
        days: [1, 2, 3, 4, 5], // Mon-Fri
      },
      delays: {
        min: 24,
        max: 72,
      },
      dailyCap: 100,
      contactFrequency: 7, // 7 days between contacts to same lead
    },
    budget: {
      maxCredits: 1000,
      maxProviderSpend: 5000, // $50
      warningThreshold: 80,
      pauseOnLimit: true,
    },
  };
}

/**
 * Create a default phase for the sequence builder
 */
export function createDefaultPhase(order: number, channel: CampaignPhase['channel'] = 'sms'): CampaignPhase {
  return {
    id: crypto.randomUUID(),
    order,
    channel,
    enabled: true,
    delay: order === 0 ? 0 : 48, // First phase immediate, others 2 days
    useAI: true,
    retryOnFail: true,
  };
}

/**
 * Convert CampaignConfig to legacy CampaignSettings format
 * for compatibility with existing campaignEngine
 */
export function toEngineSettings(config: CampaignConfig): Record<string, unknown> {
  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  return {
    // Targeting from qualification
    regions: [], // Would need to be set separately
    propertyTypes: config.qualification?.filters?.propertyTypes || [],
    priceRange: config.qualification?.filters?.priceRange || { min: 0, max: Infinity },

    // Timing
    sendWindow: {
      start: config.timing?.sendingWindows?.start || '09:00',
      end: config.timing?.sendingWindows?.end || '17:00',
    },
    sendDays: (config.timing?.sendingWindows?.days || [1, 2, 3, 4, 5]).map((d) => dayNames[d]),
    touchDelays: calculateTouchDelays(config.sequence),

    // Automation
    automationLevel: 'full_auto',
    autoSendEnabled: true,
    autoNegotiateEnabled: config.aiMessaging?.enabled || false,
    autoContractEnabled: false,

    // Thresholds
    humanReviewThreshold: 10000000, // $100k default
    maxAutoCounters: 3,
    responseTimeoutHours: 72,
    maxTouches: config.sequence?.filter((p) => p.enabled).length || 4,

    // AI settings
    aiTone: config.aiMessaging?.tone || 'professional',
    aiPersonalizationLevel: config.aiMessaging?.personalizationLevel || 'high',
    abTestingEnabled: config.aiMessaging?.useAbTesting || false,
  };
}

/**
 * Convert sequence phases to touch delay array (in days)
 */
function calculateTouchDelays(sequence: CampaignPhase[]): number[] {
  const enabledPhases = sequence.filter((p) => p.enabled).sort((a, b) => a.order - b.order);

  return enabledPhases.map((phase) => {
    // Convert hours to days, minimum 0
    return Math.max(0, Math.floor(phase.delay / 24));
  });
}

/**
 * Get channel statistics for display
 */
export function getChannelStats(config: CampaignConfig): {
  channel: string;
  enabled: boolean;
  phaseCount: number;
  estimatedCost: number;
}[] {
  const channels = ['phone', 'sms', 'email', 'voicemail', 'directMail'] as const;

  return channels.map((channel) => {
    const enabled =
      (channel === 'phone' && config.channels?.phone) ||
      (channel === 'sms' && config.channels?.sms) ||
      (channel === 'email' && config.channels?.email) ||
      (channel === 'voicemail' && config.channels?.voicemail) ||
      (channel === 'directMail' && config.channels?.directMail) ||
      false;

    const phaseCount = config.sequence?.filter((p) => p.enabled && p.channel === channel).length || 0;
    const estimatedCost = phaseCount * (CHANNEL_COSTS[channel] || 1);

    return {
      channel,
      enabled,
      phaseCount,
      estimatedCost,
    };
  });
}

/**
 * Serialize config for storage
 */
export function serializeCampaignConfig(config: CampaignConfig): string {
  return JSON.stringify(config);
}

/**
 * Deserialize config from storage
 */
export function deserializeCampaignConfig(json: string): CampaignConfig {
  const parsed = JSON.parse(json);

  // Restore dates
  if (parsed.createdAt) parsed.createdAt = new Date(parsed.createdAt);
  if (parsed.updatedAt) parsed.updatedAt = new Date(parsed.updatedAt);

  return parsed as CampaignConfig;
}

/**
 * Merge partial config with defaults
 */
export function mergeWithDefaults(partial: Partial<CampaignConfig>): CampaignConfig {
  const defaults = createDefaultConfig();

  return {
    objective: { ...defaults.objective, ...partial.objective },
    leadSource: { ...defaults.leadSource, ...partial.leadSource },
    qualification: {
      ...defaults.qualification,
      ...partial.qualification,
      filters: { ...defaults.qualification.filters, ...partial.qualification?.filters },
    },
    channels: { ...defaults.channels, ...partial.channels },
    sequence: partial.sequence?.length ? partial.sequence : defaults.sequence,
    aiMessaging: { ...defaults.aiMessaging, ...partial.aiMessaging },
    timing: {
      ...defaults.timing,
      ...partial.timing,
      sendingWindows: { ...defaults.timing.sendingWindows, ...partial.timing?.sendingWindows },
      delays: { ...defaults.timing.delays, ...partial.timing?.delays },
    },
    budget: { ...defaults.budget, ...partial.budget },
    name: partial.name,
    description: partial.description,
    tags: partial.tags,
  };
}

// ============================================================================
// Step Navigation & Progress
// ============================================================================

/**
 * Step definitions for the 10-step builder UI
 */
export const CAMPAIGN_BUILDER_STEPS = [
  { step: 1, name: 'Objective', field: 'objective', required: true },
  { step: 2, name: 'Lead Source', field: 'leadSource', required: true },
  { step: 3, name: 'Qualification', field: 'qualification', required: false },
  { step: 4, name: 'Channels', field: 'channels', required: true },
  { step: 5, name: 'Sequence', field: 'sequence', required: true },
  { step: 6, name: 'AI Messaging', field: 'aiMessaging', required: false },
  { step: 7, name: 'Timing', field: 'timing', required: true },
  { step: 8, name: 'Budget', field: 'budget', required: true },
  { step: 9, name: 'Review', field: null, required: true },
  { step: 10, name: 'Launch', field: null, required: true },
] as const;

/**
 * Get the completion status for each step
 */
export function getStepCompletionStatus(config: Partial<CampaignConfig>): {
  step: number;
  name: string;
  complete: boolean;
  hasErrors: boolean;
}[] {
  const fullConfig = mergeWithDefaults(config);
  const validation = validateCampaignConfig(fullConfig);

  return CAMPAIGN_BUILDER_STEPS.map(({ step, name }) => {
    const stepErrors = validation.errors.filter((e) => e.step === step);

    // Steps 9 and 10 are handled by UI
    if (step >= 9) {
      return {
        step,
        name,
        complete: step === 9 ? validation.valid : false,
        hasErrors: false,
      };
    }

    return {
      step,
      name,
      complete: stepErrors.length === 0,
      hasErrors: stepErrors.length > 0,
    };
  });
}

/**
 * Get a summary of the campaign configuration for review step
 */
export function getCampaignSummary(config: CampaignConfig): {
  objective: string;
  leadSource: string;
  channels: string[];
  phaseCount: number;
  estimatedContacts: number;
  estimatedCost: number;
  timing: string;
  warnings: string[];
} {
  const validation = validateCampaignConfig(config);
  const leadCount = config.leadSource.count || 100;
  const cost = estimateCampaignCost(config, leadCount);

  const enabledChannels: string[] = [];
  if (config.channels.phone) enabledChannels.push('Phone');
  if (config.channels.sms) enabledChannels.push('SMS');
  if (config.channels.email) enabledChannels.push('Email');
  if (config.channels.voicemail) enabledChannels.push('Voicemail');
  if (config.channels.directMail) enabledChannels.push('Direct Mail');

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const sendDays = config.timing.sendingWindows.days.map((d) => dayNames[d]).join(', ');

  return {
    objective: `${config.objective.target} ${config.objective.type} in ${config.objective.market}`,
    leadSource: config.leadSource.type === 'existing'
      ? `Existing list (${config.leadSource.listId || 'not selected'})`
      : config.leadSource.type === 'finder'
        ? 'Lead Finder'
        : 'Import',
    channels: enabledChannels,
    phaseCount: config.sequence.filter((p) => p.enabled).length,
    estimatedContacts: leadCount,
    estimatedCost: cost.credits,
    timing: `${config.timing.sendingWindows.start}-${config.timing.sendingWindows.end} on ${sendDays}`,
    warnings: validation.warnings.map((w) => w.message),
  };
}

/**
 * Clone a campaign configuration (for duplicating campaigns)
 */
export function cloneCampaignConfig(config: CampaignConfig): CampaignConfig {
  const cloned = JSON.parse(JSON.stringify(config)) as CampaignConfig;

  // Generate new IDs for phases
  cloned.sequence = cloned.sequence.map((phase) => ({
    ...phase,
    id: crypto.randomUUID(),
  }));

  // Update metadata
  cloned.name = config.name ? `${config.name} (Copy)` : 'Untitled Campaign (Copy)';
  cloned.createdAt = undefined;
  cloned.updatedAt = undefined;

  return cloned;
}

/**
 * Calculate estimated campaign duration in days
 */
export function estimateCampaignDuration(config: CampaignConfig): number {
  const enabledPhases = config.sequence.filter((p) => p.enabled);
  if (enabledPhases.length === 0) return 0;

  // Sum up all delays (in hours) and convert to days
  const totalDelayHours = enabledPhases.reduce((sum, phase) => sum + phase.delay, 0);
  const totalDelayDays = Math.ceil(totalDelayHours / 24);

  // Add buffer for contact frequency
  const frequencyBuffer = config.timing.contactFrequency;

  return totalDelayDays + frequencyBuffer;
}
