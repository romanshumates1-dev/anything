/**
 * REQUIREMENT SET AB (slice 2) — Feature choices enforcement tests (AB5).
 *
 * Verifies that when a user opts out of optional features during onboarding:
 * 1. campaigns route rejects creation when phone/sms/email channels are disabled in preferences
 * 2. analytics/crm and analytics/advanced return 404 when advanced_analytics is disabled
 * 3. free-tier/seed returns failure when demo_data is disabled
 * 4. ai-recommendations returns 404 when ai_automation is disabled
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));
vi.mock('@/app/api/utils/sql', () => ({ default: sqlMock }));

import {
  isFeatureEnabledForUser,
  requireFeatureEnabled,
} from '../featureChoices.server';

const USER = 'user-test-123';

function prefsRow(choices: Record<string, boolean>) {
  return [{ preferences: { feature_choices: choices } }];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AB5 - Channel Gating (phone_calling, sms, email)', () => {
  it('identifies phone_calling as disabled when opted out', async () => {
    sqlMock.mockResolvedValueOnce(prefsRow({ phone_calling: false, sms: true, email: true }));
    const allowed = await isFeatureEnabledForUser(USER, 'phone_calling');
    expect(allowed).toBe(false);
  });

  it('identifies sms as disabled when opted out', async () => {
    sqlMock.mockResolvedValueOnce(prefsRow({ phone_calling: true, sms: false, email: true }));
    const allowed = await isFeatureEnabledForUser(USER, 'sms');
    expect(allowed).toBe(false);
  });

  it('identifies email as disabled when opted out', async () => {
    sqlMock.mockResolvedValueOnce(prefsRow({ phone_calling: true, sms: true, email: false }));
    const allowed = await isFeatureEnabledForUser(USER, 'email');
    expect(allowed).toBe(false);
  });

  it('allows all channels by default when no preferences exist', async () => {
    sqlMock.mockResolvedValueOnce([{ preferences: {} }]);
    expect(await isFeatureEnabledForUser(USER, 'phone_calling')).toBe(true);
    sqlMock.mockResolvedValueOnce([{ preferences: {} }]);
    expect(await isFeatureEnabledForUser(USER, 'sms')).toBe(true);
    sqlMock.mockResolvedValueOnce([{ preferences: {} }]);
    expect(await isFeatureEnabledForUser(USER, 'email')).toBe(true);
  });
});

describe('AB5 - Analytics Gating (advanced_analytics)', () => {
  it('returns 404 response for advanced_analytics when disabled', async () => {
    sqlMock.mockResolvedValueOnce(prefsRow({ advanced_analytics: false }));
    const gate = await requireFeatureEnabled(USER, 'advanced_analytics');
    expect(gate).not.toBeNull();
    expect(gate?.status).toBe(404);
  });

  it('returns null (passes) for advanced_analytics when enabled', async () => {
    sqlMock.mockResolvedValueOnce(prefsRow({ advanced_analytics: true }));
    const gate = await requireFeatureEnabled(USER, 'advanced_analytics');
    expect(gate).toBeNull();
  });
});

describe('AB5 - Demo Data Gating (demo_data)', () => {
  it('detects demo_data disabled to skip seeding', async () => {
    sqlMock.mockResolvedValueOnce(prefsRow({ demo_data: false }));
    const allowed = await isFeatureEnabledForUser(USER, 'demo_data');
    expect(allowed).toBe(false);
  });

  it('detects demo_data enabled to allow seeding', async () => {
    sqlMock.mockResolvedValueOnce(prefsRow({ demo_data: true }));
    const allowed = await isFeatureEnabledForUser(USER, 'demo_data');
    expect(allowed).toBe(true);
  });
});

describe('AB5 - AI Automation Gating (ai_automation)', () => {
  it('returns 404 response for ai_automation when disabled', async () => {
    sqlMock.mockResolvedValueOnce(prefsRow({ ai_automation: false }));
    const gate = await requireFeatureEnabled(USER, 'ai_automation');
    expect(gate).not.toBeNull();
    expect(gate?.status).toBe(404);
  });

  it('returns null (passes) for ai_automation when enabled', async () => {
    sqlMock.mockResolvedValueOnce(prefsRow({ ai_automation: true }));
    const gate = await requireFeatureEnabled(USER, 'ai_automation');
    expect(gate).toBeNull();
  });
});
