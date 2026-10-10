/**
 * REQUIREMENT SET Q1 — workflow phase toggles, EXECUTION half.
 *
 * `campaignPhases.enabled.test.ts` already pins the REPORTING half (summary,
 * channel stats, cost, duration exclude disabled phases) and the VALIDATION
 * half (`SEQUENCE_CHANNEL_DISABLED`, `SEQUENCE_NONE_ENABLED`). The matrix still
 * marks Q1 "enabled/disabled execution NOT VERIFIED" because of the third and
 * most consequential path: what the campaign ENGINE actually executes.
 *
 * `toEngineSettings()` is that path. It converts the builder `CampaignConfig`
 * into the legacy `CampaignSettings` the campaign engine consumes, and its only
 * caller is `app/api/campaigns/route.ts` (campaign creation). Two fields carry
 * "how many touches, spaced how far apart" into execution:
 *
 *   - `maxTouches`      — the total number of touches the engine will perform
 *   - `touchDelays[]`   — the per-touch spacing, in days
 *
 * Both are derived from `config.sequence` and MUST exclude disabled phases. If
 * either dropped its `.filter(p => p.enabled)`, a campaign configured with
 * "calling OFF" would still dial — the exact defect roman.agent.md forbids
 * ("Do not show disabled workflow stages as if they are active") — and every
 * existing reporting/validation test would still pass, because none of them
 * look at the engine settings. That is the gap this file closes.
 *
 * Campaign A (calling ON, SMS ON, email OFF) is the spec's own worked example,
 * used verbatim.
 */
import { describe, it, expect } from 'vitest';
import {
  createDefaultConfig,
  toEngineSettings,
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
    ...over,
  };
}

/** Build a valid-ish config with the given enabled/disabled phase channels. */
function configWith(
  enabled: CampaignPhase['channel'][],
  disabled: CampaignPhase['channel'][],
): CampaignConfig {
  const base = createDefaultConfig();
  const on: CampaignPhase[] = enabled.map((channel, index) =>
    phase({ order: index, channel, enabled: true, delay: index * 24 }),
  );
  const off: CampaignPhase[] = disabled.map((channel, index) =>
    phase({ order: enabled.length + index, channel, enabled: false, delay: 48 }),
  );
  return {
    ...base,
    sequence: [...on, ...off],
    channels: {
      ...base.channels,
      phone: enabled.includes('phone'),
      sms: enabled.includes('sms'),
      email: enabled.includes('email'),
    },
  };
}

/** Read `maxTouches` out of the engine settings as a number. */
function maxTouches(config: CampaignConfig): number {
  return toEngineSettings(config).maxTouches as number;
}

/** Read `touchDelays` out of the engine settings as a day array. */
function touchDelays(config: CampaignConfig): number[] {
  return toEngineSettings(config).touchDelays as number[];
}

describe('Q1 — toEngineSettings excludes DISABLED phases from execution', () => {
  it('Campaign A (calling ON, SMS ON, email OFF): engine performs 2 touches, not 3', () => {
    const config = configWith(['phone', 'sms'], ['email']);
    // 3 stages exist in the sequence; only 2 are enabled.
    expect(config.sequence.length).toBe(3);
    expect(maxTouches(config)).toBe(2);
  });

  it('touchDelays has one entry per ENABLED phase, in order', () => {
    const config = configWith(['phone', 'sms'], ['email']);
    const delays = touchDelays(config);
    expect(delays).toHaveLength(2);
    // phase 0 (immediate) -> 0 days, phase 1 (delay 24h) -> 1 day.
    expect(delays).toEqual([0, 1]);
  });

  it('a disabled phase never contributes a delay slot', () => {
    // The disabled email phase has delay 48h (=2 days). If the filter were
    // dropped, that 2-day slot would appear in the executed cadence.
    const config = configWith(['sms'], ['email', 'phone']);
    expect(touchDelays(config)).toEqual([0]);
  });

  it('adding more disabled phases does NOT change what the engine executes', () => {
    // The strongest guard: padding a campaign with OFF stages must leave the
    // executed cadence byte-identical to the lean campaign.
    const lean = configWith(['phone', 'sms'], []);
    const padded = configWith(['phone', 'sms'], ['email', 'voicemail', 'directMail'] as CampaignPhase['channel'][]);
    expect(padded.sequence.length).toBeGreaterThan(lean.sequence.length);
    expect(maxTouches(padded)).toBe(maxTouches(lean));
    expect(touchDelays(padded)).toEqual(touchDelays(lean));
  });

  it('touchDelays follow ENABLED order even when a disabled phase sorts first', () => {
    const base = createDefaultConfig();
    // A disabled phase at order 0, an enabled one at order 5.
    const sequence: CampaignPhase[] = [
      phase({ order: 0, channel: 'email', enabled: false, delay: 72 }),
      phase({ order: 5, channel: 'sms', enabled: true, delay: 24 }),
    ];
    const config: CampaignConfig = {
      ...base,
      sequence,
      channels: { ...base.channels, sms: true, phone: false, email: false },
    };
    expect(maxTouches(config)).toBe(1);
    expect(touchDelays(config)).toEqual([1]);
  });

  it('maxTouches and touchDelays agree with each other', () => {
    for (const [on, off] of [
      [['sms'], [] as CampaignPhase['channel'][]],
      [['phone', 'sms'], ['email'] as CampaignPhase['channel'][]],
      [['phone', 'sms', 'email'], [] as CampaignPhase['channel'][]],
      [['sms'], ['phone', 'email', 'voicemail'] as CampaignPhase['channel'][]],
    ] as [CampaignPhase['channel'][], CampaignPhase['channel'][]][]) {
      const config = configWith(on, off);
      expect(maxTouches(config)).toBe(on.length);
      expect(touchDelays(config)).toHaveLength(on.length);
    }
  });
});
