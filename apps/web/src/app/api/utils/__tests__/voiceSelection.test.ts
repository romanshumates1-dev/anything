/**
 * REQUIREMENT SET T — AI VOICE SELECTION (BEHAVIOURAL TEST).
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
 * THE GAP THIS EXISTS FOR (verified against the tree at 66889b7, not assumed)
 * ------------------------------------------------------------------------
 * A repo-wide sweep for `voiceId` / `voice_id` / `voiceSelect` /
 * `selectedVoice` / `voicePreference` / `recommendedVoice` / `autoVoice`
 * returned **0 hits across src/**. The files that mention "voice" are the
 * gateway (`api/gateway/voice-gateway.ts`), regional-messaging compliance
 * rules, and the cadence engine — none hold a per-campaign voice choice. So
 * the requirement was genuinely absent, not merely unverified.
 *
 * THE THREE PROPERTIES THAT MATTER
 * --------------------------------
 * 1. DETERMINISTIC. Identical context must yield an identical voice. A
 *    recommender that reaches for randomness would make a campaign's voice
 *    drift between runs, which the spec explicitly forbids.
 * 2. EXPLAINABLE. The result carries the factors that produced it, so an
 *    operator debugging "why did it pick this voice?" gets an answer.
 * 3. STICKY UNDER MANUAL CONTROL. A manual choice is the user's decision.
 *    Auto must never silently re-select over it.
 */
import { describe, expect, it } from 'vitest';
import {
  AUTO_VOICE_CATALOG,
  resolveVoiceSelection,
  type VoiceSelectionContext,
} from '../voiceSelection';

const baseContext: VoiceSelectionContext = {
  aiTone: 'professional',
  automationLevel: 'semi_auto',
  market: 'Phoenix, AZ',
  channels: ['phone'],
  objectiveType: 'deals',
};

describe('Set T — AI voice selection', () => {
  describe('manual selection', () => {
    it('honours an explicit manual choice', () => {
      const result = resolveVoiceSelection({
        mode: 'manual',
        selectedVoiceId: 'twilio.jane',
        context: baseContext,
      });

      expect(result.voiceId).toBe('twilio.jane');
      expect(result.source).toBe('manual');
    });

    it('never overwrites a manual choice even when context favours another voice', () => {
      const manual = resolveVoiceSelection({
        mode: 'manual',
        selectedVoiceId: 'twilio.marcus',
        context: { ...baseContext, aiTone: 'urgent' },
      });

      const auto = resolveVoiceSelection({
        mode: 'auto',
        context: { ...baseContext, aiTone: 'urgent' },
      });

      expect(manual.voiceId).toBe('twilio.marcus');
      // Auto picks something — but it is a SEPARATE decision. It never leaks
      // back into the manual selection, because manual never calls the
      // recommender at all.
      expect(auto.source).toBe('auto');
    });

    it('rejects a manual id that is not in the catalogue', () => {
      const result = resolveVoiceSelection({
        mode: 'manual',
        selectedVoiceId: 'not-a-real-voice',
        context: baseContext,
      });

      expect(result.voiceId).not.toBe('not-a-real-voice');
      expect(result.error).toBeTruthy();
    });
  });

  describe('auto selection is deterministic', () => {
    it('returns the same voice for the same context across repeated calls', () => {
      const first = resolveVoiceSelection({ mode: 'auto', context: baseContext });
      const second = resolveVoiceSelection({ mode: 'auto', context: baseContext });
      const third = resolveVoiceSelection({ mode: 'auto', context: baseContext });

      expect(first.voiceId).toBe(second.voiceId);
      expect(second.voiceId).toBe(third.voiceId);
    });

    it('is stable across 200 invocations (no randomness, no clock)', () => {
      const runs = new Set<string>();
      for (let i = 0; i < 200; i++) {
        runs.add(resolveVoiceSelection({ mode: 'auto', context: baseContext }).voiceId ?? '');
      }

      // One distinct answer, not 200. A Math.random()/Date.now() implementation
      // fails here immediately.
      expect(runs.size).toBe(1);
    });

describe('auto selection reacts to campaign context', () => {
    it('differs between a calm tone and an urgent tone', () => {
      const calm = resolveVoiceSelection({
        mode: 'auto',
        context: { ...baseContext, aiTone: 'empathetic' },
      });
      const urgent = resolveVoiceSelection({
        mode: 'auto',
        context: { ...baseContext, aiTone: 'urgent' },
      });

      expect(calm.voiceId).not.toBe(urgent.voiceId);
    });

    it('differs between a manual-approval workflow and a fully automatic one', () => {
      const assisted = resolveVoiceSelection({
        mode: 'auto',
        context: { ...baseContext, automationLevel: 'semi_auto' },
      });
      const autonomous = resolveVoiceSelection({
        mode: 'auto',
        context: { ...baseContext, automationLevel: 'full_auto' },
      });

      expect(assisted.voiceId).not.toBe(autonomous.voiceId);
    });

    it('never recommends a voice when calling is not one of the channels', () => {
      const result = resolveVoiceSelection({
        mode: 'auto',
        context: { ...baseContext, channels: ['sms', 'email'] },
      });

      expect(result.voiceId).toBeNull();
      expect(result.error).toBe('NO_CALLING_CHANNEL');
    });
  });

  describe('explainability', () => {
    it('returns the factors that produced the recommendation', () => {
      const result = resolveVoiceSelection({ mode: 'auto', context: baseContext });

      expect(result.factors.length).toBeGreaterThan(0);
      for (const factor of result.factors) {
        expect(factor.name).toBeTruthy();
        expect(factor.detail).toBeTruthy();
        // Each factor carries a signed score so an operator can see WHY one
        // voice beat another, not just that a winner existed.
        expect(Number.isFinite(factor.score)).toBe(true);
      }
    });

    it('keeps a previously auto-resolved voice when context has not materially changed', () => {
      // The "do not randomly change a user's selected voice" clause also binds
      // Auto: a voice already in use must not drift on a no-op save.
      const first = resolveVoiceSelection({ mode: 'auto', context: baseContext });

      const second = resolveVoiceSelection({
        mode: 'auto',
        context: { ...baseContext },
        previouslyResolvedVoiceId: first.voiceId ?? undefined,
      });

      expect(second.voiceId).toBe(first.voiceId);
    });

    it('re-resolves when the context materially changed', () => {
      const first = resolveVoiceSelection({
        mode: 'auto',
        context: { ...baseContext, aiTone: 'professional' },
      });

      const changed = resolveVoiceSelection({
        mode: 'auto',
        context: { ...baseContext, aiTone: 'urgent' },
        previouslyResolvedVoiceId: first.voiceId ?? undefined,
      });

      expect(changed.voiceId).not.toBe(first.voiceId);
    });
  });
});
    it('only ever recommends voices that exist in the catalogue', () => {
      const result = resolveVoiceSelection({ mode: 'auto', context: baseContext });
      expect(AUTO_VOICE_CATALOG.some((v) => v.id === result.voiceId)).toBe(true);
    });
  });