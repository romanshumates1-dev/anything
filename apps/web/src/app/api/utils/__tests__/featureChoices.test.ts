/**
 * REQUIREMENT SET AB — feature-choice codec contract (see module header for
 * the requirement text). Pure-function suite; no I/O.
 *
 * The hazard each group of assertions exists to catch:
 *  - a default flip (any default false) would strip a feature from every
 *    pre-existing account that never answered;
 *  - a truthy-coercion ("just use !!value") resurrects declined features;
 *  - a missing-key consumer path breaks the first time an older row is read;
 *  - a payload builder that forgets the `gamification_enabled` mirror
 *    produces a toggle that saves and enforces NOTHING.
 */
import { describe, it, expect } from 'vitest';
import {
  FEATURE_CHOICES_PREF_KEY,
  FEATURE_CHOICE_IDS,
  DEFAULT_FEATURE_CHOICES,
  normalizeFeatureChoices,
  resolveFeatureChoice,
  buildFeaturePreferencePayload,
  type FeatureChoices,
} from '../featureChoices';
import { GAMIFICATION_PREF_KEY, DEFAULT_GAMIFICATION_ENABLED } from '../gamification';

describe('identity and defaults', () => {
  it('uses the stable storage key', () => {
    expect(FEATURE_CHOICES_PREF_KEY).toBe('feature_choices');
  });

  it('covers exactly the seven master-spec features', () => {
    expect([...FEATURE_CHOICE_IDS].sort()).toEqual(
      [
        'ai_automation',
        'advanced_analytics',
        'demo_data',
        'email',
        'gamification',
        'phone_calling',
        'sms',
      ].sort(),
    );
  });

  it('defaults every feature ON — never-changed accounts keep what they had', () => {
    for (const id of FEATURE_CHOICE_IDS) {
      expect(DEFAULT_FEATURE_CHOICES[id], id).toBe(true);
    }
  });

  it('agrees with the gamification module default (one source of truth)', () => {
    expect(DEFAULT_FEATURE_CHOICES.gamification).toBe(DEFAULT_GAMIFICATION_ENABLED);
    expect(GAMIFICATION_PREF_KEY).toBe('gamification_enabled');
  });
});

describe('normalizeFeatureChoices', () => {
  it('honours strict booleans for known ids', () => {
    const out = normalizeFeatureChoices({ sms: false, ai_automation: false });
    expect(out.sms).toBe(false);
    expect(out.ai_automation).toBe(false);
    // Everything else filled with defaults — all seven keys present.
    expect(Object.keys(out).sort()).toEqual([...FEATURE_CHOICE_IDS].sort());
    expect(out.email).toBe(true);
  });

  it('rejects the truthy-coercion failure modes: "false", 0, 1, null keep the default', () => {
    const out = normalizeFeatureChoices({
      sms: 'false', // string — !!'false' === true would ALSO pass; use 0 to expose it:
      demo_data: 0, // !!0 === false under sloppy coercion; must stay default true
      email: 1, // !!1 === true — indistinguishable, but must not be STORED as number
      phone_calling: null,
    });
    expect(out.sms).toBe(true);
    expect(out.demo_data).toBe(true);
    expect(out.email).toBe(true);
    expect(out.phone_calling).toBe(true);
    // And the stored types are booleans, not the inputs echoed back.
    for (const v of Object.values(out)) expect(typeof v).toBe('boolean');
  });

  it('drops unknown keys entirely (allowlist is the seven ids)', () => {
    const out = normalizeFeatureChoices({
      gamification: false,
      evil: false,
      __proto__x: true,
      constructor: false,
    });
    expect(JSON.stringify(out)).not.toContain('evil');
    expect(JSON.stringify(out)).not.toContain('constructor');
    expect(Object.keys(out).sort()).toEqual([...FEATURE_CHOICE_IDS].sort());
  });

  it('returns full defaults for every wrong shape', () => {
    for (const bad of [null, undefined, 'x', 42, true, [], [1, 2]]) {
      expect(normalizeFeatureChoices(bad)).toEqual(DEFAULT_FEATURE_CHOICES);
    }
  });

  it('coerces field-by-field, not all-or-nothing (partial writes survive)', () => {
    const out = normalizeFeatureChoices({ gamification: false, email: 'nonsense' });
    expect(out.gamification).toBe(false);
    expect(out.email).toBe(true);
  });
});

describe('resolveFeatureChoice (reader)', () => {
  it('reads an explicit false out of a stored blob', () => {
    const blob = {
      [FEATURE_CHOICES_PREF_KEY]: { sms: false },
    };
    expect(resolveFeatureChoice(blob, 'sms')).toBe(false);
    expect(resolveFeatureChoice(blob, 'email')).toBe(true);
  });

  it('resolves to defaults on wrong shapes and missing keys', () => {
    expect(resolveFeatureChoice(null, 'sms')).toBe(true);
    expect(resolveFeatureChoice('garbage', 'gamification')).toBe(true);
    expect(resolveFeatureChoice({ other_key: 1 }, 'demo_data')).toBe(true);
    expect(resolveFeatureChoice({ [FEATURE_CHOICES_PREF_KEY]: 'oops' }, 'sms')).toBe(true);
  });

  it('does not crash on a corrupt partial record', () => {
    const out = normalizeFeatureChoices({ sms: { nested: true } });
    expect(out.sms).toBe(true);
  });
});

describe('buildFeaturePreferencePayload (wire contract)', () => {
  it('emits exactly feature_choices + gamification_enabled, both honest', () => {
    const payload = buildFeaturePreferencePayload({
      ...DEFAULT_FEATURE_CHOICES,
      gamification: false,
    });
    expect(Object.keys(payload).sort()).toEqual(
      ['feature_choices', 'gamification_enabled'].sort(),
    );
    // The mirror is what every existing enforcement point reads.
    expect(payload.gamification_enabled).toBe(false);
    expect(payload.feature_choices.gamification).toBe(false);
  });

  it('normalises sloppy input before it reaches the wire', () => {
    const payload = buildFeaturePreferencePayload({
      sms: 'nope',
      gamification: false,
    } as unknown as FeatureChoices);
    expect(payload.feature_choices.sms).toBe(true);
    expect(payload.gamification_enabled).toBe(false);
    expect(Object.keys(payload.feature_choices).sort()).toEqual(
      [...FEATURE_CHOICE_IDS].sort(),
    );
  });

  it('with no changes at all still produces a complete, all-ON payload', () => {
    const payload = buildFeaturePreferencePayload(DEFAULT_FEATURE_CHOICES);
    expect(payload.feature_choices).toEqual(DEFAULT_FEATURE_CHOICES);
    expect(payload.gamification_enabled).toBe(true);
  });
});
