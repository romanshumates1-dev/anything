// @vitest-environment jsdom
/**
 * REQUIREMENT SET AB — the onboarding questionnaire must ASK which optional
 * features the user wants, and the answer must reach the server.
 *
 * Source of truth: `.github/agents/roman.agent.md` (SET AB):
 *
 *     During onboarding ask users which optional features they want enabled.
 *     Respect those choices. Do not force-enable unnecessary features.
 *
 * Before this existed, NOTHING in the product asked — the welcome
 * questionnaire covered experience/market/tools/budget, and the gamification
 * ON/OFF key was writable only by hand-crafting a PATCH to
 * /api/user/preferences. This suite pins the missing half:
 *
 *  1. the questionnaire renders a feature-choice step with all seven
 *     master-spec features, each individually toggleable, defaulting ON
 *     (existing-behaviour defaults);
 *  2. completing the questionnaire sends `buildFeaturePreferencePayload(...)`
 *     to PATCH /api/user/preferences — the choices actually leave the
 *     browser, with the gamification mirror key included;
 *  3. toggling one feature off in the UI results in `false` in that payload
 *     (the UI is wired to the payload, not decorative);
 *  4. SKIP writes NO preferences — skipping is not consent, and must not
 *     silently record seven ON choices the user never made.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { SignupQuestionnaire } from './SignupQuestionnaire';
import {
  FEATURE_CHOICE_IDS,
  buildFeaturePreferencePayload,
  DEFAULT_FEATURE_CHOICES,
} from '@/app/api/utils/featureChoices';

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
}));

/** URL-keyed fetch stub; records every call for payload assertions. */
const fetchMock = vi.hoisted(() =>
  vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ({
    ok: true,
    json: async () => ({ success: true }),
  })),
);

function callsTo(path: string, method: string) {
  return fetchMock.mock.calls.filter(
    ([u, init]) =>
      String(u) === path &&
      (init?.method ?? 'GET').toUpperCase() === method.toUpperCase(),
  );
}

async function clickThroughToLastStep() {
  // 3 original steps of profile questions → the feature step is #4.
  for (let i = 0; i < 3; i++) {
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SET AB — onboarding feature-choices step', () => {
  it('renders all seven master-spec features as ON toggles on the final step', async () => {
    render(<SignupQuestionnaire />);
    await clickThroughToLastStep();

    expect(
      screen.getByRole('heading', { name: /optional features/i }),
    ).toBeTruthy();

    for (const id of FEATURE_CHOICE_IDS) {
      const toggle = screen.getByRole('switch', { name: new RegExp(id.replace('_', ' '), 'i') });
      // Plain attribute read: jest-dom matchers are not registered under the
      // api vitest config this suite runs with.
      expect(toggle.getAttribute('aria-checked')).toBe('true');
    }
  });

  it('sends the choices to PATCH /api/user/preferences on completion', async () => {
    render(<SignupQuestionnaire />);
    await clickThroughToLastStep();

    fireEvent.click(screen.getByRole('button', { name: /Get Started/ }));

    await waitFor(() =>
      expect(callsTo('/api/user/preferences', 'PATCH').length).toBe(1),
    );

    // The questionnaire itself is still posted first, unchanged.
    expect(callsTo('/api/user/questionnaire', 'POST').length).toBe(1);

    const [, init] = callsTo('/api/user/preferences', 'PATCH')[0];
    const body = JSON.parse(String(init?.body));
    // Untouched defaults: full record, all ON, gamification mirror = true.
    expect(body).toEqual(buildFeaturePreferencePayload(DEFAULT_FEATURE_CHOICES));
    expect(body.gamification_enabled).toBe(true);
    expect(Object.keys(body.feature_choices).sort()).toEqual(
      [...FEATURE_CHOICE_IDS].sort(),
    );
  });

  it('a feature toggled OFF in the UI arrives as false in the payload', async () => {
    render(<SignupQuestionnaire />);
    await clickThroughToLastStep();

    // The decorative-toggle failure mode: clicking changes local state but
    // the payload still says ON. Turn SMS off, then complete.
    const smsToggle = screen.getByRole('switch', { name: /sms/i });
    fireEvent.click(smsToggle);
    expect(smsToggle.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: /Get Started/ }));
    await waitFor(() =>
      expect(callsTo('/api/user/preferences', 'PATCH').length).toBe(1),
    );

    const [, init] = callsTo('/api/user/preferences', 'PATCH')[0];
    const body = JSON.parse(String(init?.body));
    expect(body.feature_choices.sms).toBe(false);
    // Everything else untouched.
    expect(body.feature_choices).toEqual({
      ...DEFAULT_FEATURE_CHOICES,
      sms: false,
    });
  });

  it('SKIP records NO feature choices — skipping is not consent', async () => {
    render(<SignupQuestionnaire />);
    await clickThroughToLastStep();

    fireEvent.click(screen.getByRole('button', { name: /Skip for now/ }));

    await waitFor(() =>
      expect(callsTo('/api/user/questionnaire', 'POST').length).toBe(1),
    );
    expect(callsTo('/api/user/preferences', 'PATCH').length).toBe(0);
    expect(push).toHaveBeenCalledWith('/dashboard');
  });
});
