/**
 * REQUIREMENT SET T — AI VOICE SELECTION.
 *
 * Source of truth: `.github/agents/roman.agent.md` lines 1199–1216.
 *
 *   For campaigns using calling:
 *     Voice selection options:
 *       * Auto
 *       * Manually selected voice
 *     When Auto is selected:
 *       Use a deterministic recommendation system based on available campaign
 *       context. The recommendation must be explainable enough to debug.
 *       Do not randomly change a user's selected voice.
 *
 * WHY THIS IS A PURE MODULE
 * -------------------------
 * The hard part of the requirement is not "pick a voice" — it is picking the
 * SAME voice every time for the same inputs, and being able to say why. Both
 * properties are far easier to guarantee (and to test) if the decision is a
 * pure function of its context with no clock, no random source, and no I/O.
 * Persistence and UI live elsewhere; this file is the decision itself.
 *
 * DETERMINISM, EXPLICITLY
 * ----------------------
 * Ranking is summed factor score, then catalogue position. Catalogue position
 * is a fixed property of the table below, not an iteration order over a Map.
 * There is no `Math.random`, no `Date.now`, no random id.
 *
 * EXPLAINABILITY
 * --------------
 * Every scored factor is returned with the voices it favoured and penalised, so
 * "why did it pick Jane?" is answerable from the returned value alone.
 *
 * HONESTY NOTE
 * ------------
 * These are the provider voice IDs Twilio accepts in `<Say voice="...">`. The
 * weights below encode *product judgement about which register suits which
 * campaign context*, not measured conversion data — no such dataset exists in
 * this repo. They are therefore simple inspectable integers, documented as a
 * "recommendation", never as "optimisation".
 */

export type VoiceSelectionMode = 'auto' | 'manual';

/** Campaign context that legitimately influences which voice suits the call. */
export interface VoiceSelectionContext {
  /** `campaign_settings.ai_tone` */
  aiTone?: string;
  /** `campaign_settings.automation_level` */
  automationLevel?: string;
  /** Free-text market, e.g. "Phoenix, AZ". */
  market?: string;
  /** Enabled outreach channels. Calling absent ⇒ no voice is needed. */
  channels?: string[];
  /** `campaigns.objective_type` — drives what the call has to accomplish. */
  objectiveType?: string;
}

export interface VoiceDefinition {
  /** Provider-scoped id, passed verbatim to the TTS provider. */
  id: string;
  label: string;
  gender: 'female' | 'male' | 'neutral';
  /**
   * Qualitative descriptors used by the scorer. Kept coarse on purpose: the
   * scorer matches tags, so a new voice is describable without re-tuning.
   */
  tags: string[];
}

/**
 * The candidate pool.
 *
 * Order is meaningful: it is the documented tie-break, so APPEND new voices
 * rather than reordering existing ones. Reordering silently changes which
 * voice an Auto campaign with tied scores resolves to.
 *
 * TAG ORTHOGONALITY IS LOAD-BEARING
 * --------------------------------
 * Each dimension the scorer reads (tone, automation level, objective, market)
 * needs at least one voice that wins THAT dimension. An early draft gave
 * `twilio.jane` both `credible` and `consistent`, which made her win every
 * automation level and silently flattened the `automation_level` factor to a
 * no-op — the tests caught it, and that is why the tag sets below are spread
 * across voices rather than concentrated on one.
 */
export const AUTO_VOICE_CATALOG: readonly VoiceDefinition[] = Object.freeze([
  { id: 'twilio.jane', label: 'Jane - measured, professional', gender: 'female', tags: ['measured', 'professional'] },
  { id: 'twilio.marcus', label: 'Marcus - direct, energetic', gender: 'male', tags: ['direct', 'energetic', 'assertive', 'brief'] },
  { id: 'twilio.carmen', label: 'Carmen - warm, conversational', gender: 'female', tags: ['warm', 'conversational', 'gentle', 'bilingual'] },
  { id: 'twilio.brian', label: 'Brian - steady, neutral', gender: 'male', tags: ['steady', 'neutral', 'consistent', 'clear'] },
  { id: 'twilio.nancy', label: 'Nancy - patient, gentle', gender: 'female', tags: ['patient', 'gentle', 'empathetic', 'soft'] },
  { id: 'twilio.tony', label: 'Tony - brisk, businesslike', gender: 'male', tags: ['brisk', 'businesslike', 'direct', 'brief'] },
  { id: 'twilio.sam', label: 'Sam - even-tempo, adaptable', gender: 'neutral', tags: ['steady', 'neutral', 'adaptable', 'clear'] },
  { id: 'twilio.alice', label: 'Alice - clear, deliberate', gender: 'female', tags: ['clear', 'deliberate', 'credible', 'consistent'] },
]);

/** One scored reason, returned so the recommendation is auditable. */
export interface VoiceFactor {
  /** Stable machine name, e.g. `ai_tone`. */
  name: string;
  /** Human sentence explaining the factor's direction. */
  detail: string;
  /** Signed weight applied to matching voices. */
  score: number;
  /** Voices this factor favoured. */
  favoured: string[];
  /** Voices this factor penalised. */
  penalised: string[];
}

export interface VoiceResolution {
  /** Chosen provider voice id, or null when no voice applies. */
  voiceId: string | null;
  source: VoiceSelectionMode | 'none';
  /** Every factor considered, in evaluation order. */
  factors: VoiceFactor[];
  /**
   * Stable hash of the inputs that drove the decision. Two resolutions with
   * the same fingerprint were made from the same context, so a changed voice
   * between them is a real change rather than noise.
   */
  contextFingerprint: string;
  /** Machine-readable failure reason; absent on success. */
  error?: string;
}

export interface ResolveVoiceInput {
  mode: VoiceSelectionMode;
  selectedVoiceId?: string | null;
  context: VoiceSelectionContext;
  /**
   * The voice already persisted for this campaign, if any. Recorded in the
   * explanation so an operator can see whether a deployed voice was retained
   * or superseded, and why.
   */
  previouslyResolvedVoiceId?: string | null;
}

/** Market names whose catchment skews Spanish-primary, favouring a bilingual voice. */
const BILINGUAL_MARKET_HINTS = [
  'miami', 'hialeah', 'los angeles', 'san antonio', 'chicago', 'houston',
  'phoenix', 'tucson', 'el paso', 'fresno', 'new york',
];

/** `ai_tone` to the descriptor that suits it. One tag per tone, deliberately. */
const TONE_TAG: Record<string, string> = {
  professional: 'professional',
  casual: 'conversational',
  friendly: 'warm',
  urgent: 'assertive',
  empathetic: 'empathetic',
};

/** `automation_level` to what an unattended or assisted call demands. */
const AUTOMATION_TAG: Record<string, string> = {
  full_auto: 'consistent',
  semi_auto: 'credible',
  manual: 'adaptable',
};

/** Objective to the register that suits the ask the call has to make. */
const OBJECTIVE_TAG: Record<string, string> = {
  deals: 'brief',
  leads: 'conversational',
  appointments: 'clear',
};

function scoreTag(
  factorName: string,
  detail: string,
  tag: string,
  weight: number,
): VoiceFactor {
  const favoured: string[] = [];
  const penalised: string[] = [];
  for (const voice of AUTO_VOICE_CATALOG) {
    (voice.tags.includes(tag) ? favoured : penalised).push(voice.id);
  }
  return { name: factorName, detail, score: weight, favoured, penalised };
}

/**
 * FNV-1a over the ordered context fields. Not a security primitive — it exists
 * so two resolutions can be compared cheaply, and so "the context changed"
 * becomes a decidable statement rather than a guess.
 */
function fingerprint(context: VoiceSelectionContext): string {
  const canonical = JSON.stringify([
    context.aiTone ?? null,
    context.automationLevel ?? null,
    (context.market ?? '').trim().toLowerCase(),
    [...(context.channels ?? [])].map((c) => c.toLowerCase()).sort(),
    context.objectiveType ?? null,
  ]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Resolve which voice a campaign should dial with.
 *
 * Manual mode short-circuits before any scoring: the user's decision IS the
 * decision. Only Auto consults the catalogue, which is what makes "do not
 * randomly change a user's selected voice" structurally true rather than merely
 * intended.
 */
export function resolveVoiceSelection(input: ResolveVoiceInput): VoiceResolution {
  const { mode, context } = input;
  const fp = fingerprint(context);

  if (mode === 'manual') {
    const selected = input.selectedVoiceId;
    const known = AUTO_VOICE_CATALOG.find((v) => v.id === selected);
    if (!known) {
      return {
        voiceId: null,
        source: 'none',
        factors: [],
        contextFingerprint: fp,
        error: 'UNKNOWN_MANUAL_VOICE',
      };
    }
    return {
      voiceId: known.id,
      source: 'manual',
      factors: [
        {
          name: 'manual_choice',
          detail: `Operator selected "${known.label}". Automatic scoring is bypassed entirely.`,
          score: 0,
          favoured: [known.id],
          penalised: [],
        },
      ],
      contextFingerprint: fp,
    };
  }

  const channels = (context.channels ?? []).map((c) => c.toLowerCase());
  const callsOut =
    channels.includes('phone') ||
    channels.includes('voice') ||
    channels.includes('voicemail');
  if (!callsOut) {
    return {
      voiceId: null,
      source: 'none',
      factors: [],
      contextFingerprint: fp,
      error: 'NO_CALLING_CHANNEL',
    };
  }

  if (AUTO_VOICE_CATALOG.length === 0) {
    return {
      voiceId: null,
      source: 'none',
      factors: [],
      contextFingerprint: fp,
      error: 'EMPTY_CATALOG',
    };
  }

  // Fixed evaluation order, so the explanation reads identically every time.
  const factors: VoiceFactor[] = [];

  const tone = (context.aiTone ?? '').toLowerCase();
  if (tone && TONE_TAG[tone]) {
    factors.push(
      scoreTag(
        'ai_tone',
        `Campaign tone "${tone}" suits a ${TONE_TAG[tone]} delivery.`,
        TONE_TAG[tone],
        3,
      ),
    );
  }

  const automation = (context.automationLevel ?? '').toLowerCase();
  if (automation && AUTOMATION_TAG[automation]) {
    factors.push(
      scoreTag(
        'automation_level',
        automation === 'full_auto'
          ? 'Calls place without operator intervention, so an even, consistent delivery was preferred.'
          : `Automation level "${automation}" suits a ${AUTOMATION_TAG[automation]} delivery.`,
        AUTOMATION_TAG[automation],
        // Weighted ABOVE tone deliberately: an unattended call plays without a
        // human present, so delivery consistency is the stronger requirement.
        // If tone outranked this, changing only the automation level would leave
        // the recommendation untouched and the factor would be decorative.
        4,
      ),
    );
  }

  const objective = (context.objectiveType ?? '').toLowerCase();
  if (objective && OBJECTIVE_TAG[objective]) {
    factors.push(
      scoreTag(
        'objective_type',
        `Objective "${objective}" calls for a ${OBJECTIVE_TAG[objective]} delivery.`,
        OBJECTIVE_TAG[objective],
        1,
      ),
    );
  }

  const market = (context.market ?? '').trim().toLowerCase();
  if (BILINGUAL_MARKET_HINTS.some((hint) => market.includes(hint))) {
    factors.push(
      scoreTag(
        'market_locale',
        `Market "${context.market}" skews Spanish-primary, so a bilingual-capable voice was favoured.`,
        'bilingual',
        2,
      ),
    );
  }

  // Deterministic ranking: summed factor score, with catalogue position as the
  // documented tie-break. The `- index * 1e-6` term encodes that tie-break in
  // the score itself, so the comparator needs no second key and no reliance on
  // sort stability.
  const scores = new Map<string, number>();
  AUTO_VOICE_CATALOG.forEach((voice, index) => {
    let score = 0;
    for (const factor of factors) {
      if (factor.favoured.includes(voice.id)) score += factor.score;
    }
    scores.set(voice.id, score - index * 1e-6);
  });

  const ranked = [...AUTO_VOICE_CATALOG].sort(
    (a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0),
  );
  const winner = ranked[0];
  const previous = input.previouslyResolvedVoiceId;
  const previousIsValid = AUTO_VOICE_CATALOG.some((v) => v.id === previous);

  return {
    voiceId: winner.id,
    source: 'auto',
    factors: [
      ...factors,
      {
        name: 'ranking',
        detail:
          `Ranked ${AUTO_VOICE_CATALOG.length} catalogue voices by summed factor score; ` +
          `ties break on catalogue order. Winner "${winner.label}"` +
          (previousIsValid ? `; previously resolved voice "${previous}"` : '') +
          '.',
        score: 0,
        favoured: [winner.id],
        penalised: ranked.slice(1).map((v) => v.id),
      },
    ],
    contextFingerprint: fp,
  };
}