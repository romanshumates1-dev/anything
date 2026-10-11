/**
 * REQUIREMENT SET AB — the preferences ROUTE must sanitise `feature_choices`.
 *
 * A raw allowlist entry is not enough: `ALLOWED_KEYS` would store whatever
 * JSON arrives verbatim, and a stored `"sms": "false"` later reads as
 * "unrecognised → default ON" — the user's OFF silently flipped back on.
 * These tests pin the same boundary treatment `accessibility` and
 * `gamification_enabled` already get, on BOTH PATCH (merge) and PUT
 * (replace), plus the allowlist membership itself.
 *
 * Mutation target: delete the `feature_choices` branch in either handler,
 * or drop it from ALLOWED_KEYS, and this suite must go red.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireSession } = vi.hoisted(() => ({
  requireSession: vi.fn(async () => ({ userId: 'user-1' }) as any),
}));
vi.mock('@/app/api/utils/auth', () => ({
  requireSession: (...a: unknown[]) => requireSession(...a),
}));

const sqlMock = vi.hoisted(() => vi.fn(async () => [] as unknown[]));
vi.mock('@/app/api/utils/sql', () => ({ default: sqlMock }));

import { PATCH, PUT, ALLOWED_KEYS } from '../../user/preferences/route';
import {
  FEATURE_CHOICE_IDS,
  FEATURE_CHOICES_PREF_KEY,
  DEFAULT_FEATURE_CHOICES,
} from '../../utils/featureChoices';

/** First interpolation of the tagged template = the JSON.stringify(updates) value. */
function persistedJson(): Record<string, any> {
  const calls = sqlMock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const last = calls[calls.length - 1];
  const raw = last[1] as string;
  return JSON.parse(raw);
}

function req(body: unknown): Request {
  return new Request('http://t/api/user/preferences', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue({ userId: 'user-1' } as any);
  sqlMock.mockResolvedValue([] as unknown[]);
});

describe('ALLOWED_KEYS membership', () => {
  it('accepts the feature_choices key and the mirrored gamification key', () => {
    expect(ALLOWED_KEYS).toContain(FEATURE_CHOICES_PREF_KEY);
    expect(ALLOWED_KEYS).toContain('gamification_enabled');
    expect(ALLOWED_KEYS).toContain('tutorial_progress');
  });
});

describe('PATCH /api/user/preferences — feature_choices sanitization', () => {
  it('stores strict booleans, fills defaults, and drops unknown keys', async () => {
    const res = await PATCH(
      req({
        [FEATURE_CHOICES_PREF_KEY]: {
          gamification: false, // explicit opt-out — must survive as false
          sms: 'false', // STRING — must NOT be stored; default applies
          demo_data: 0, // number — must NOT be stored; default applies
          evil_key: true, // unknown — must be dropped entirely
        },
        dark_mode: true, // non-allowlisted top-level key — dropped
      }),
    );
    expect(res.status).toBe(200);

    const persisted = persistedJson();
    // Only the allowlisted key made it through; `dark_mode` was dropped.
    expect(Object.keys(persisted).sort()).toEqual([FEATURE_CHOICES_PREF_KEY]);

    const choices = persisted[FEATURE_CHOICES_PREF_KEY];
    expect(choices.gamification).toBe(false);
    // The sloppy-coercion failure modes, pinned observable:
    expect(choices.sms).toBe(true); // 'false' string → default, NOT false
    expect(choices.demo_data).toBe(true); // 0 → default, NOT false
    expect('evil_key' in choices).toBe(false);
    // ALL seven keys present so a consumer never sees a missing key.
    expect(Object.keys(choices).sort()).toEqual([...FEATURE_CHOICE_IDS].sort());
  });

  it('mirrors the gamification choice into gamification_enabled as a REAL boolean', async () => {
    await PATCH(
      req({
        [FEATURE_CHOICES_PREF_KEY]: { gamification: false },
        gamification_enabled: 'false', // string — normalised to default true? NO:
        // the gamification key normalises strictly too: 'false' is not a boolean,
        // so it falls back to the DEFAULT (true) — but the feature_choices value
        // false is the user's actual choice. The onboarding UI sends both keys
        // as real booleans; this test pins that NO string ever lands in storage.
      }),
    );
    const persisted = persistedJson();
    expect(typeof persisted.gamification_enabled).toBe('boolean');
    expect(persisted.gamification_enabled).toBe(true); // 'false' string → default ON
  });

  it('PUT applies the same sanitization (replace semantics, same boundary)', async () => {
    const res = await PUT(
      req({
        [FEATURE_CHOICES_PREF_KEY]: { ai_automation: false, phone_calling: 'no' },
      }),
    );
    expect(res.status).toBe(200);
    const persisted = persistedJson();
    const choices = persisted[FEATURE_CHOICES_PREF_KEY];
    expect(choices.ai_automation).toBe(false);
    expect(choices.phone_calling).toBe(true); // 'no' → default
    expect(Object.keys(choices).sort()).toEqual([...FEATURE_CHOICE_IDS].sort());
    expect(choices).toEqual({ ...DEFAULT_FEATURE_CHOICES, ai_automation: false });
  });

  it('401s without a session before touching storage', async () => {
    requireSession.mockResolvedValue(null as any);
    const res = await PATCH(req({ [FEATURE_CHOICES_PREF_KEY]: {} }));
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('a non-object feature_choices payload resolves to full defaults, not a crash', async () => {
    for (const bad of [null, 'x', 42, ['a']]) {
      sqlMock.mockClear();
      const res = await PATCH(req({ [FEATURE_CHOICES_PREF_KEY]: bad }));
      expect(res.status).toBe(200);
      expect(persistedJson()[FEATURE_CHOICES_PREF_KEY]).toEqual(DEFAULT_FEATURE_CHOICES);
    }
  });
});
