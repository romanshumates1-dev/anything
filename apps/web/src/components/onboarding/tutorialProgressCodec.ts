/**
 * REQUIREMENT SET Z — tutorial progress codec (steps 9 and 10).
 *
 * Source of truth: `.github/agents/roman.agent.md` lines 1398-1400:
 *
 *     9. Allow returning later.
 *    10. Preserve progress.
 *
 * WHY A SHARED CODEC
 * ------------------
 * The tutorial must keep progress in two places at once:
 *
 *   - localStorage, so the flow survives a refresh instantly and works offline;
 *   - the server (`user_preferences.tutorial_progress`), so it survives another
 *     device, a new browser, or cleared site data.
 *
 * Two independent `JSON.parse` / `JSON.stringify` call sites for one logical
 * value is how those two stores start to disagree — and a disagreement here is
 * invisible: the user just finds the tutorial "forgot" them. One codec, used by
 * both paths, makes that divergence impossible rather than merely unlikely.
 *
 * WHY EVERY FIELD IS VALIDATED
 * ---------------------------
 * The server value is persisted data. A row written by an older build, a
 * truncated write, or a value that arrived from a client is not trusted: an
 * out-of-range step index would strand a user on a step that no longer exists,
 * with no way forward and no error. Clamping on read is cheap; a wedged
 * tutorial is not.
 *
 * PURE BY CONSTRUCTION: no storage, no fetch, no clock. Everything here is a
 * function of its arguments, which is what makes it testable at all.
 */

/** Tutorial progress as this module represents it. */
export interface TutorialProgress {
  /** Zero-based index of the step the user is on. */
  step: number;
  /** Zero-based indices of steps the user has finished. */
  completed: number[];
}

/**
 * Highest valid step index for a tutorial of `totalSteps` steps.
 * Exported so the component can assert its own step count rather than
 * hard-coding a number that drifts when a step is added.
 */
export function MAX_STEP_INDEX(totalSteps: number): number {
  return Math.max(0, totalSteps - 1);
}

/** Force an arbitrary number into `[0, max]`, or null when it is not a number. */
function clampStep(value: unknown, max: number): number | null {
  // `Number.isInteger` rather than truthiness: `0` is valid progress and must
  // survive. A `value || 0` style check would discard it and restart the flow.
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return Math.min(Math.max(value, 0), max);
}

/**
 * Normalise a completed-step list: integers only, in range, de-duplicated and
 * sorted, so two encodings of the same progress compare equal.
 */
function normalizeCompleted(value: unknown, totalSteps: number): number[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  for (const entry of value) {
    const clamped = clampStep(entry, totalSteps - 1);
    if (clamped !== null) seen.add(clamped);
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * Parse a stored payload into usable progress.
 *
 * Returns null when the payload is absent, malformed, or of the wrong shape —
 * the caller then starts from a clean state, which is the same behaviour the
 * tutorial had before (its inline try/catch around `JSON.parse`).
 */
export function decodeTutorialProgress(
  raw: string | null | undefined,
  totalSteps = 8,
): TutorialProgress | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A corrupt row must not break the tutorial for that user.
    return null;
  }

  // Reject arrays and primitives: `{step, completed}` is an object contract.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const { step, completed } = parsed as Record<string, unknown>;
  const clampedStep = clampStep(step, MAX_STEP_INDEX(totalSteps));
  if (clampedStep === null) return null;

  return {
    step: clampedStep,
    completed: normalizeCompleted(completed, totalSteps),
  };
}

/**
 * Serialise progress for storage.
 *
 * The output is normalised for the same reason decode is: a value written from
 * an out-of-date component must not be able to persist a step the tutorial
 * does not have.
 */
export function encodeTutorialProgress(
  progress: TutorialProgress,
  totalSteps = 8,
): string {
  const step = clampStep(progress?.step, MAX_STEP_INDEX(totalSteps)) ?? 0;
  return JSON.stringify({
    step,
    completed: normalizeCompleted(progress?.completed, totalSteps),
  });
}