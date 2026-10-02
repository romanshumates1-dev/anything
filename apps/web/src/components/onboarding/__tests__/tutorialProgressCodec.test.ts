/**
 * REQUIREMENT SET Z — ONBOARDING TUTORIAL, steps 9 and 10 (BEHAVIOURAL TEST).
 *
 * Source of truth: `.github/agents/roman.agent.md` lines 1379–1402. The ten
 * required behaviours end with:
 *
 *     8. Allow skipping safely.
 *     9. Allow returning later.
 *    10. Preserve progress.
 *
 * THE GAP THIS EXISTS FOR (verified against the tree at 03e3cb4, not assumed)
 * ------------------------------------------------------------------------
 * `OnboardingTutorial.tsx` keeps progress in exactly two places, both of them
 * per-device:
 *
 *     const TUTORIAL_PROGRESS_KEY = 'tutorial_step_progress';
 *     localStorage.setItem(TUTORIAL_PROGRESS_KEY, JSON.stringify({ step, completed }));
 *
 * On completion it does call the API — but only for `onboarding_completed`.
 * The server already accepts a `tutorial_progress` key: it is listed in
 * `ALLOWED_KEYS` in `api/user/preferences/route.ts` and nothing ever writes it.
 *
 * So requirement 10 holds only in the weak sense. Progress survives a refresh
 * on one browser, and does NOT survive:
 *   * signing in on another device,
 *   * clearing site data,
 *   * a new browser profile,
 *   * "returning later" from a different machine — which is exactly what
 *     requirement 9 asks to support.
 *
 * A user who got halfway through the tutorial, closed the laptop, and came
 * back on their phone starts again from step 0.
 *
 * THE FIX SHAPE
 * -------------
 * A pure codec for the progress payload, so the component can sync the same
 * value to localStorage (fast, offline-tolerant) and to the server (durable)
 * without two divergent serialisation paths that can disagree.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_STEP_INDEX,
  decodeTutorialProgress,
  encodeTutorialProgress,
  type TutorialProgress,
} from '../tutorialProgressCodec';

const TOTAL_STEPS = 8;

describe('Set Z — tutorial progress is preservable', () => {
  describe('encode', () => {
    it('round-trips a valid progress value', () => {
      const progress: TutorialProgress = { step: 3, completed: [0, 1, 2] };
      expect(decodeTutorialProgress(encodeTutorialProgress(progress))).toEqual(progress);
    });

    it('never emits a step beyond the tutorial', () => {
      const encoded = JSON.parse(
        encodeTutorialProgress({ step: 99, completed: [0, 1, 99] }),
      ) as TutorialProgress;

      expect(encoded.step).toBeLessThanOrEqual(MAX_STEP_INDEX(TOTAL_STEPS));
      for (const step of encoded.completed) {
        expect(step).toBeLessThan(TOTAL_STEPS);
        expect(step).toBeGreaterThanOrEqual(0);
      }
    });

    it('de-duplicates and sorts the completed list', () => {
      const encoded = JSON.parse(
        encodeTutorialProgress({ step: 2, completed: [3, 1, 3, 0, 1] }),
      ) as TutorialProgress;

      expect(encoded.completed).toEqual([0, 1, 3]);
    });
  });

  describe('decode', () => {
    it('returns null for absent or malformed input rather than throwing', () => {
      // The current implementation already wraps JSON.parse in try/catch and
      // starts fresh. That behaviour must survive the move to server sync: a
      // corrupt server value must not break the tutorial for that user.
      expect(decodeTutorialProgress(null)).toBeNull();
      expect(decodeTutorialProgress(undefined)).toBeNull();
      expect(decodeTutorialProgress('')).toBeNull();
      expect(decodeTutorialProgress('{not json')).toBeNull();
      expect(decodeTutorialProgress('[1,2,3]')).toBeNull();
      expect(decodeTutorialProgress('{"step":"two","completed":[]}')).toBeNull();
    });

    it('never returns a step index the tutorial does not have', () => {
      // A stale row (tutorial shortened in a later release) must not strand the
      // user on a step that no longer exists.
      const decoded = decodeTutorialProgress(
        JSON.stringify({ step: 50, completed: [0, 50] }),
      );

      expect(decoded).not.toBeNull();
      expect(decoded!.step).toBeLessThanOrEqual(MAX_STEP_INDEX(TOTAL_STEPS));
      expect(decoded!.completed.every((s) => s < TOTAL_STEPS)).toBe(true);
    });

    it('never returns a negative step, whatever arrives in the payload', () => {
      const decoded = decodeTutorialProgress(
        JSON.stringify({ step: -4, completed: [-1] }),
      );

      expect(decoded!.step).toBeGreaterThanOrEqual(0);
      expect(decoded!.completed.every((s) => s >= 0)).toBe(true);
    });
  });

  describe('requirement 9 — returning later', () => {
    it('restores the exact step and completed set from a stored payload', () => {
      const original = { step: 4, completed: [0, 1, 2, 3] };
      const stored = encodeTutorialProgress(original);

      expect(decodeTutorialProgress(stored)).toEqual(original);
    });

    it('treats an explicit step 0 as real progress, not as absent progress', () => {
      // The subtle one: `step || 0` and friends would collapse a legitimate
      // first-step resume into "no progress", restarting the tutorial.
      const decoded = decodeTutorialProgress(JSON.stringify({ step: 0, completed: [] }));

      expect(decoded).toEqual({ step: 0, completed: [] });
    });
  });
});