/**
 * REQUIREMENT SET AB — ONBOARDING FEATURE CHOICES (codec contract).
 *
 * Source of truth: `.github/agents/roman.agent.md` (SET AB):
 *
 *     During onboarding ask users which optional features they want enabled.
 *     Examples: gamification, phone calling, SMS, email, advanced analytics,
 *     AI automation, demo data.
 *     Respect those choices. Do not force-enable unnecessary features.
 *
 * WHY A SHARED CODEC (same reasoning as tutorialProgressCodec and
 * sanitizeAccessibility): the choices are stored in `user.preferences`
 * (jsonb) and read back by client AND server code. Two independent
 * coercions of one logical value is how they start to disagree, and the
 * disagreement is invisible — the user just finds a feature they declined
 * turned back on. One pure module, used by the questionnaire write path,
 * the preferences route sanitizer, and every reader.
 *
 * DEFAULTS ARE ON — and that is deliberate, not lazy. Every optional
 * feature in this app has ALWAYS been visible to every account. Defaulting
 * a never-chosen feature to OFF would silently strip UI from every
 * pre-existing account the first time any code path reads a missing
 * preference. "Do not force-enable" applies to a user who DECLINED; a user
 * who never answered must keep exactly what they had.
 *
 * PURE BY CONSTRUCTION: no storage, no fetch, no clock.
 */

/** The stored preference key inside `user.preferences`. */
export const FEATURE_CHOICES_PREF_KEY = 'feature_choices';

/**
 * The seven optional features the master spec lists, verbatim.
 * Ids are snake_case so they can round-trip as JSON object keys without an
 * encoder.
 */
export const FEATURE_CHOICE_IDS = [
  'gamification',
  'phone_calling',
  'sms',
  'email',
  'advanced_analytics',
  'ai_automation',
  'demo_data',
] as const;

export type FeatureChoiceId = (typeof FEATURE_CHOICE_IDS)[number];

export type FeatureChoices = Record<FeatureChoiceId, boolean>;

/**
 * A user with no stored choices keeps every feature they have always had.
 * `gamification` must agree with `DEFAULT_GAMIFICATION_ENABLED` in
 * `utils/gamification.ts` — the two defaults are asserted equal by test so
 * they cannot drift.
 */
export const DEFAULT_FEATURE_CHOICES: FeatureChoices = {
  gamification: true,
  phone_calling: true,
  sms: true,
  email: true,
  advanced_analytics: true,
  ai_automation: true,
  demo_data: true,
};

/**
 * Coerce an arbitrary payload into a complete, honest `FeatureChoices`.
 *
 * Strictness rules (each one exists because the sloppy version is harmful):
 *  - Only literal `true` / `false` are honoured. A stored STRING 'false'
 *    read as truthy would resurrect a feature the user switched off; a
 *    stored 0/1 guessed at in either direction is the same class of bug.
 *  - Unknown keys are DROPPED, never stored: the allowlist is the seven ids
 *    and nothing else, so a hand-crafted PATCH cannot park arbitrary data
 *    inside the preferences blob under this key.
 *  - Every output record has ALL seven keys (partial input is filled with
 *    defaults field-by-field), so a consumer never has to reason about a
 *    missing key, and reverting a choice to the default actually clears it.
 */
export function normalizeFeatureChoices(input: unknown): FeatureChoices {
  const out: FeatureChoices = { ...DEFAULT_FEATURE_CHOICES };
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return out;
  }
  const src = input as Record<string, unknown>;
  for (const id of FEATURE_CHOICE_IDS) {
    const v = src[id];
    // Strict booleans only. Everything else keeps the default.
    if (typeof v === 'boolean') out[id] = v;
  }
  return out;
}

/**
 * Read one choice out of a preferences blob (the GET shape:
 * `{ preferences: {...} }` or the blob itself). Tolerates every wrong shape:
 * a reader must never crash because a partially-written row came back as an
 * array or a string, and an unreadable blob resolves to the default — the
 * same behaviour as a user who never chose.
 */
export function resolveFeatureChoice(
  preferences: unknown,
  id: FeatureChoiceId,
): boolean {
  if (typeof preferences !== 'object' || preferences === null || Array.isArray(preferences)) {
    return DEFAULT_FEATURE_CHOICES[id];
  }
  const blob = (preferences as Record<string, unknown>)[FEATURE_CHOICES_PREF_KEY];
  const choices = normalizeFeatureChoices(blob);
  return choices[id];
}

/**
 * The exact `PATCH /api/user/preferences` body the onboarding step sends.
 *
 * This exists so the wire contract has ONE definition. In particular it
 * mirrors the gamification choice into the standalone `gamification_enabled`
 * key, because that is the key every existing enforcement point reads
 * (Shell nav gating, `requireGamificationEnabled` server gates). Writing the
 * choice only into `feature_choices` would produce a stored preference that
 * NOTHING enforces — a toggle that saves and does nothing.
 */
export function buildFeaturePreferencePayload(choices: FeatureChoices): {
  feature_choices: FeatureChoices;
  gamification_enabled: boolean;
} {
  const normalized = normalizeFeatureChoices(choices);
  return {
    feature_choices: normalized,
    gamification_enabled: normalized.gamification,
  };
}
