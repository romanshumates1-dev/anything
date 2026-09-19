import { describe, it, expect } from 'vitest';
import {
  validateCampaignConfig,
  estimateCampaignCost,
  createDefaultConfig,
  createDefaultPhase,
  mergeWithDefaults,
  validateStep,
  getStepCompletionStatus,
  getCampaignSummary,
  cloneCampaignConfig,
  estimateCampaignDuration,
  CAMPAIGN_BUILDER_STEPS,
  type CampaignConfig,
} from '../campaignBuilder';

describe('campaignBuilder', () => {
  describe('validateCampaignConfig', () => {
    it('validates a complete valid config', () => {
      const config = createDefaultConfig();
      config.objective.market = 'Phoenix, AZ';
      config.leadSource.listId = 'test-list-123'; // Required for 'existing' type

      const result = validateCampaignConfig(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('fails when objective type is missing', () => {
      const config = createDefaultConfig();
      config.objective.market = 'Phoenix, AZ';
      // @ts-expect-error - Testing invalid input
      config.objective.type = undefined;

      const result = validateCampaignConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'OBJECTIVE_TYPE_REQUIRED')).toBe(true);
    });

    it('fails when no channels are enabled', () => {
      const config = createDefaultConfig();
      config.objective.market = 'Phoenix, AZ';
      config.channels = {
        phone: false,
        sms: false,
        email: false,
      };

      const result = validateCampaignConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'CHANNELS_NONE_ENABLED')).toBe(true);
    });

    it('fails when sequence is empty', () => {
      const config = createDefaultConfig();
      config.objective.market = 'Phoenix, AZ';
      config.sequence = [];

      const result = validateCampaignConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'SEQUENCE_EMPTY')).toBe(true);
    });

    it('fails when sequence uses disabled channel', () => {
      const config = createDefaultConfig();
      config.objective.market = 'Phoenix, AZ';
      config.channels.sms = false;
      // Default sequence has SMS phases

      const result = validateCampaignConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'SEQUENCE_CHANNEL_DISABLED')).toBe(true);
    });

    it('warns about weekend sends', () => {
      const config = createDefaultConfig();
      config.objective.market = 'Phoenix, AZ';
      config.timing.sendingWindows.days = [0, 1, 2, 3, 4, 5, 6]; // Include Sunday (0) and Saturday (6)

      const result = validateCampaignConfig(config);

      expect(result.warnings.some((w) => w.message.includes('Weekend'))).toBe(true);
    });

    it('validates time format', () => {
      const config = createDefaultConfig();
      config.objective.market = 'Phoenix, AZ';
      config.timing.sendingWindows.start = '25:00'; // Invalid

      const result = validateCampaignConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'TIMING_START_INVALID')).toBe(true);
    });
  });

  describe('validateStep', () => {
    it('validates step 1 (objective)', () => {
      const result = validateStep(1, {
        objective: { type: 'deals', target: 10, market: '' },
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe('OBJECTIVE_MARKET_REQUIRED');
    });

    it('validates step 4 (channels)', () => {
      const result = validateStep(4, {
        channels: { phone: false, sms: false, email: false },
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe('CHANNELS_NONE_ENABLED');
    });
  });

  describe('estimateCampaignCost', () => {
    it('calculates cost for SMS-only campaign', () => {
      const config = createDefaultConfig();
      config.objective.market = 'Phoenix, AZ';
      config.sequence = [
        createDefaultPhase(0, 'sms'),
      ];
      config.qualification.enabled = false; // No filtering

      const result = estimateCampaignCost(config, 100);

      // SMS cost is 1 credit per lead, with AI multiplier of 1.2 and retry 1.1
      // 100 * 1 * 1.2 * 1.1 = 132 credits
      expect(result.credits).toBe(132);
      expect(result.breakdown.sms).toBe(132);
      expect(result.perLead).toBeCloseTo(1.32, 1);
    });

    it('calculates cost for multi-channel campaign', () => {
      const config = createDefaultConfig();
      config.objective.market = 'Phoenix, AZ';
      config.qualification.enabled = false;

      const result = estimateCampaignCost(config, 100);

      // Has SMS, email phases
      expect(result.credits).toBeGreaterThan(0);
      expect(result.breakdown.sms).toBeGreaterThan(0);
      expect(result.breakdown.email).toBeGreaterThan(0);
    });

    it('applies qualification filter to reduce cost', () => {
      const config = createDefaultConfig();
      config.objective.market = 'Phoenix, AZ';

      const withFilter = estimateCampaignCost(config, 100);

      config.qualification.enabled = false;
      const withoutFilter = estimateCampaignCost(config, 100);

      expect(withFilter.credits).toBeLessThan(withoutFilter.credits);
    });

    it('calculates provider cost correctly', () => {
      const config = createDefaultConfig();
      config.objective.market = 'Phoenix, AZ';
      config.qualification.enabled = false;
      config.sequence = [createDefaultPhase(0, 'sms')];
      config.sequence[0].useAI = false;
      config.sequence[0].retryOnFail = false;

      const result = estimateCampaignCost(config, 100);

      // 100 credits * $0.02 = $2.00 = 200 cents
      expect(result.providerCost).toBe(result.credits * 2);
    });
  });

  describe('createDefaultConfig', () => {
    it('creates valid default config', () => {
      const config = createDefaultConfig();
      config.objective.market = 'Test Market';
      config.leadSource.listId = 'test-list-123'; // Required for 'existing' type

      const result = validateCampaignConfig(config);

      expect(result.valid).toBe(true);
    });

    it('has sensible defaults', () => {
      const config = createDefaultConfig();

      expect(config.objective.type).toBe('deals');
      expect(config.channels.sms).toBe(true);
      expect(config.channels.email).toBe(true);
      expect(config.aiMessaging.enabled).toBe(true);
      expect(config.timing.sendingWindows.days).toEqual([1, 2, 3, 4, 5]); // Weekdays
    });
  });

  describe('createDefaultPhase', () => {
    it('creates phase with correct order', () => {
      const phase = createDefaultPhase(2, 'email');

      expect(phase.order).toBe(2);
      expect(phase.channel).toBe('email');
      expect(phase.enabled).toBe(true);
      expect(phase.delay).toBe(48); // Non-first phase has delay
    });

    it('first phase has no delay', () => {
      const phase = createDefaultPhase(0, 'sms');

      expect(phase.delay).toBe(0);
    });
  });

  describe('mergeWithDefaults', () => {
    it('merges partial config with defaults', () => {
      const partial: Partial<CampaignConfig> = {
        objective: { type: 'leads', target: 50, market: 'Denver, CO' },
      };

      const result = mergeWithDefaults(partial);

      expect(result.objective.type).toBe('leads');
      expect(result.objective.target).toBe(50);
      expect(result.channels.sms).toBe(true); // Default
      expect(result.timing.dailyCap).toBe(100); // Default
    });

    it('preserves nested properties', () => {
      const partial: Partial<CampaignConfig> = {
        timing: {
          sendingWindows: { start: '10:00', end: '16:00', days: [1, 2, 3] },
          delays: { min: 12, max: 48 },
          dailyCap: 50,
          contactFrequency: 5,
        },
      };

      const result = mergeWithDefaults(partial);

      expect(result.timing.sendingWindows.start).toBe('10:00');
      expect(result.timing.dailyCap).toBe(50);
    });
  });

  describe('CAMPAIGN_BUILDER_STEPS', () => {
    it('has 10 steps', () => {
      expect(CAMPAIGN_BUILDER_STEPS).toHaveLength(10);
    });

    it('has correct step numbers', () => {
      CAMPAIGN_BUILDER_STEPS.forEach((step, index) => {
        expect(step.step).toBe(index + 1);
      });
    });
  });

  describe('getStepCompletionStatus', () => {
    it('returns completion status for all 10 steps', () => {
      const config = createDefaultConfig();
      config.objective.market = 'Phoenix, AZ';

      const status = getStepCompletionStatus(config);

      expect(status).toHaveLength(10);
      status.forEach((s) => {
        expect(s).toHaveProperty('step');
        expect(s).toHaveProperty('name');
        expect(s).toHaveProperty('complete');
        expect(s).toHaveProperty('hasErrors');
      });
    });

    it('marks incomplete steps correctly', () => {
      const config = createDefaultConfig();
      // Missing market makes step 1 incomplete
      config.objective.market = '';

      const status = getStepCompletionStatus(config);
      const step1 = status.find((s) => s.step === 1);

      expect(step1?.complete).toBe(false);
      expect(step1?.hasErrors).toBe(true);
    });
  });

  describe('getCampaignSummary', () => {
    it('returns campaign summary', () => {
      const config = createDefaultConfig();
      config.objective.market = 'Phoenix, AZ';
      config.name = 'Test Campaign';

      const summary = getCampaignSummary(config);

      expect(summary.objective).toContain('deals');
      expect(summary.objective).toContain('Phoenix, AZ');
      expect(summary.channels).toContain('SMS');
      expect(summary.channels).toContain('Email');
      expect(summary.phaseCount).toBeGreaterThan(0);
      expect(summary.estimatedCost).toBeGreaterThan(0);
    });
  });

  describe('cloneCampaignConfig', () => {
    it('creates a deep copy with new phase IDs', () => {
      const original = createDefaultConfig();
      original.name = 'Original Campaign';
      original.objective.market = 'Phoenix, AZ';

      const cloned = cloneCampaignConfig(original);

      // Name should be updated
      expect(cloned.name).toContain('Copy');

      // Phase IDs should be different
      expect(cloned.sequence[0].id).not.toBe(original.sequence[0].id);

      // Other values should be the same
      expect(cloned.objective.market).toBe(original.objective.market);
    });

    it('does not mutate original', () => {
      const original = createDefaultConfig();
      const originalPhaseId = original.sequence[0].id;

      const cloned = cloneCampaignConfig(original);
      cloned.objective.market = 'Different Market';

      expect(original.sequence[0].id).toBe(originalPhaseId);
      expect(original.objective.market).not.toBe('Different Market');
    });
  });

  describe('estimateCampaignDuration', () => {
    it('calculates duration based on sequence delays', () => {
      const config = createDefaultConfig();
      config.sequence = [
        createDefaultPhase(0, 'sms'), // 0 hours delay
        createDefaultPhase(1, 'email'), // 48 hours delay (2 days)
        createDefaultPhase(2, 'sms'), // 48 hours delay (2 days)
      ];
      config.timing.contactFrequency = 7;

      const duration = estimateCampaignDuration(config);

      // Total delays: 0 + 48 + 48 = 96 hours = 4 days
      // Plus contact frequency buffer of 7 days = 11 days
      expect(duration).toBe(11);
    });

    it('returns 0 for empty sequence', () => {
      const config = createDefaultConfig();
      config.sequence = [];

      const duration = estimateCampaignDuration(config);

      expect(duration).toBe(0);
    });
  });
});
