/**
 * REQUIREMENT SET Y1 / U1 — "Do not show disabled workflow stages as if they
 * are active."
 *
 * Source: `.github/agents/roman.agent.md` ~1095-1137.
 *
 *     Campaign creation should support configurable workflow phases.
 *     Users should be able to: TURN ON / TURN OFF individual phases.
 *     Campaign A: calling ON, SMS ON, email OFF.
 *     Campaign B: calling OFF, SMS ON, email ON.
 *     The system must dynamically adapt to enabled phases.
 *     Do not show disabled workflow stages as if they are active.
 *
 * WHAT WAS ALREADY TRUE, AND WHAT THIS FILE ADDS
 * ----------------------------------------------
 * `campaignBuilder.ts` implements the model (`CampaignPhase.enabled` +
 * `ChannelConfig`) and enforces it at VALIDATION time — an enabled phase whose
 * channel is off is an error (`SEQUENCE_CHANNEL_DISABLED`), and a sequence with
 * nothing enabled is an error (`SEQUENCE_NONE_ENABLED`). The existing
 * `campaignBuilder.test.ts` covers that.
 *
 * What it did NOT cover is the requirement's second half: that the values
 * REPORTED to the user exclude disabled phases. A builder could validate
 * perfectly and still report "4 phases" for a campaign with 2 enabled and 2
 * switched off — showing a disabled stage as active. That is exactly the defect
 * roman.agent.md forbids, and it is a silent one because it only misleads
 * rather than breaking anything.
 *
 * These tests pin the REPORTING paths: summary phase count, duration estimate,
 * channel statistics and cost. If any of them starts counting a disabled phase,
 * a user would be told their campaign does something it does not.
 *
 * Campaign A and Campaign B below are the two worked examples from the
 * requirement text, used verbatim so the examples in the spec are the examples
 * in the test.
 */
import { describe, it, expect } from 'vitest';
import {
  createDefaultConfig,
  estimateCampaignCost,
  estimateCampaignDuration,
  getCampaignSummary,
  getChannelStats,
  validateCampaignConfig,
  type CampaignConfig,
  type CampaignPhase,
} from '../campaignBuilder';

function phase(over: Partial<CampaignPhase> & { order: number }): CampaignPhase {
  return {
    id: `phase-${over.order}`,
    channel: 'sms',
    enabled: true,
    delay: over.order === 0 ? 0 : 24,
    useAI: false,
    retryOnFail: false,
    template: 'tpl',
    ...over,
  };
}

/** A config with both enabled and disabled phases, as a real builder emits. */
function configWith(
  enabled: CampaignPhase['channel'][],
  disabled: CampaignPhase['channel'][],
): CampaignConfig {
  const base = createDefaultConfig();

  // `createDefaultConfig()` is a WORKING DRAFT, not a valid campaign: it ships
  // no objective.market and no leadSource.listId. Fill the two required fields
  // so `valid` here reflects the phase/channel rules under test rather than
  // two unrelated draft defaults.
  const draft: CampaignConfig = {
    ...base,
    objective: { ...base.objective, market: 'Raleigh, NC' },
    leadSource: { ...base.leadSource, listId: 'list-under-test' },
  };

  const on: CampaignPhase[] = enabled.map((channel, index) =>
    phase({ order: index, channel, enabled: true }),
  );
  const off: CampaignPhase[] = disabled.map((channel, index) =>
    phase({ order: enabled.length + index, channel, enabled: false, delay: 48 }),
  );
  const sequence = [...on, ...off];
  return {
    ...draft,
    channels: {
      ...draft.channels,
      phone: enabled.includes('phone'),
      sms: enabled.includes('sms'),
      email: enabled.includes('email'),
      voicemail: enabled.includes('voicemail'),
      directMail: enabled.includes('directMail'),
    },
    sequence,
  };
}

describe('Y1 / U1 — disabled workflow stages are never reported as active', () => {
  describe('Campaign A: calling ON, SMS ON, email OFF', () => {
    const config = configWith(['phone', 'sms'], ['email']);

    it('the disabled phase is present in the sequence but marked off', () => {
      // The plan genuinely contains 3 steps; only 2 are active.
      expect(config.sequence).toHaveLength(3);
      expect(config.sequence.filter((p) => p.enabled)).toHaveLength(2);
      expect(config.sequence.filter((p) => !p.enabled)).toHaveLength(1);
    });

    it('summary phase count reports only the enabled phases', () => {
      expect(getCampaignSummary(config).phaseCount).toBe(2);
    });

    it('channel stats exclude the disabled email phase', () => {
      const stats = getChannelStats(config);
      const email = stats.find((s) => s.channel === 'email');
      expect(email?.phaseCount).toBe(0);
      expect(email?.enabled).toBe(false);
    });

    it('channel stats count only enabled phases on active channels', () => {
      const stats = getChannelStats(config);
      expect(stats.find((s) => s.channel === 'phone')?.phaseCount).toBe(1);
      expect(stats.find((s) => s.channel === 'sms')?.phaseCount).toBe(1);
      const total = stats.reduce((sum, s) => sum + s.phaseCount, 0);
      expect(total).toBe(2);
    });

    it('duration reflects only the enabled phases', () => {
      const withDisabled = estimateCampaignDuration(config);
      const withoutDisabled = estimateCampaignDuration(
        configWith(['phone', 'sms'], []),
      );
      // The disabled phase carries a 48h delay; if it were counted the totals
      // would differ. They must not.
      expect(withDisabled).toBe(withoutDisabled);
    });

    it('cost ignores the disabled phase', () => {
      const withDisabled = estimateCampaignCost(config, 100);
      const withoutDisabled = estimateCampaignCost(configWith(['phone', 'sms'], []), 100);
      expect(withDisabled.credits).toBe(withoutDisabled.credits);
    });

    it('the config still validates as a real campaign', () => {
      expect(validateCampaignConfig(config).valid).toBe(true);
    });
  });

  describe('Campaign B: calling OFF, SMS ON, email ON', () => {
    const config = configWith(['sms', 'email'], ['phone']);

    it('summary reports 2, not the 3 stages present', () => {
      expect(getCampaignSummary(config).phaseCount).toBe(2);
    });

    it('the disabled calling stage reports zero', () => {
      const stats = getChannelStats(config);
      expect(stats.find((s) => s.channel === 'phone')?.phaseCount).toBe(0);
      expect(stats.find((s) => s.channel === 'phone')?.enabled).toBe(false);
    });

    it('the two enabled stages report one each', () => {
      const stats = getChannelStats(config);
      expect(stats.find((s) => s.channel === 'sms')?.phaseCount).toBe(1);
      expect(stats.find((s) => s.channel === 'email')?.phaseCount).toBe(1);
    });

    it('validates as a real campaign', () => {
      expect(validateCampaignConfig(config).valid).toBe(true);
    });
  });

  describe('reporting never exceeds the enabled set', () => {
    it('every channel phase count sums to the enabled phase count', () => {
      const config = configWith(['phone', 'sms', 'email'], ['voicemail', 'directMail']);
      const stats = getChannelStats(config);
      const summed = stats.reduce((sum, s) => sum + s.phaseCount, 0);
      const enabled = config.sequence.filter((p) => p.enabled).length;

      expect(summed).toBe(enabled);
      expect(getCampaignSummary(config).phaseCount).toBe(enabled);
      expect(summed).toBe(3);
      expect(summed).not.toBe(config.sequence.length); // 5 stages exist
    });

    it('adding a disabled phase changes nothing a user is told', () => {
      const lean = configWith(['sms'], []);
      const padded = configWith(['sms'], ['email', 'phone']);

      expect(getCampaignSummary(padded).phaseCount).toBe(
        getCampaignSummary(lean).phaseCount,
      );
      expect(estimateCampaignDuration(padded)).toBe(estimateCampaignDuration(lean));
      expect(estimateCampaignCost(padded, 100).credits).toBe(
        estimateCampaignCost(lean, 100).credits,
      );
      expect(getChannelStats(padded).reduce((s, x) => s + x.phaseCount, 0)).toBe(
        getChannelStats(lean).reduce((s, x) => s + x.phaseCount, 0),
      );
    });
  });

  describe('the ON/OFF switch cannot be abused to claim work', () => {
    it('rejects a sequence where every phase is switched off', () => {
      // "Do not show disabled workflow stages as if they are active" cuts both
      // ways: a campaign with nothing enabled must not validate.
      const allOff = configWith([], ['phone', 'sms', 'email']);
      const result = validateCampaignConfig(allOff);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'SEQUENCE_NONE_ENABLED')).toBe(true);
    });

    it('rejects an enabled phase whose channel is switched off', () => {
      const base = createDefaultConfig();
      const bogus: CampaignConfig = {
        ...base,
        channels: { ...base.channels, email: false },
        sequence: [phase({ order: 0, channel: 'email', enabled: true })],
      };
      const result = validateCampaignConfig(bogus);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'SEQUENCE_CHANNEL_DISABLED')).toBe(true);
    });
  });
});