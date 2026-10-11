/**
 * REQUIREMENT SET AB (slice 2) - the shared server gate is honest.
 *
 * Mutation targets: delete the preferences read, flip the 404 to 403/200, or
 * fail closed on DB errors, and this suite must go red. Modelled on the
 * gamification gate contract (`requireGamificationEnabled`): 404-not-403 so a
 * declined surface does not confirm it exists, fail-OPEN on read errors so a
 * transient DB blip never hides product surfaces from everyone.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));
vi.mock("@/app/api/utils/sql", () => ({ default: sqlMock }));

import {
  isFeatureEnabledForUser,
  requireFeatureEnabled,
} from "../featureChoices.server";

const USER = "user-1";

function prefsRow(preferences: unknown) {
  return [{ preferences }];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isFeatureEnabledForUser", () => {
  it("returns true when the user explicitly enabled the feature", async () => {
    sqlMock.mockResolvedValueOnce(prefsRow({ feature_choices: { demo_data: true } }));
    await expect(isFeatureEnabledForUser(USER, "demo_data")).resolves.toBe(true);
  });

  it("returns false when the user explicitly declined the feature", async () => {
    sqlMock.mockResolvedValueOnce(prefsRow({ feature_choices: { demo_data: false } }));
    await expect(isFeatureEnabledForUser(USER, "demo_data")).resolves.toBe(false);
  });

  it("defaults ON for a user who never answered (no stored choices)", async () => {
    sqlMock.mockResolvedValueOnce(prefsRow({}));
    await expect(isFeatureEnabledForUser(USER, "advanced_analytics")).resolves.toBe(true);
  });

  it("defaults ON when the preferences row is missing or unreadable", async () => {
    sqlMock.mockResolvedValueOnce([]);
    await expect(isFeatureEnabledForUser(USER, "sms")).resolves.toBe(true);
    sqlMock.mockResolvedValueOnce([{ preferences: "garbage" }]);
    await expect(isFeatureEnabledForUser(USER, "sms")).resolves.toBe(true);
  });

  it("fails OPEN on a database error (never hides surfaces on a blip)", async () => {
    sqlMock.mockRejectedValueOnce(new Error("db down"));
    await expect(isFeatureEnabledForUser(USER, "demo_data")).resolves.toBe(true);
  });

  it("scopes the preferences read to the caller (no cross-user read)", async () => {
    sqlMock.mockResolvedValueOnce(prefsRow({ feature_choices: { demo_data: false } }));
    await isFeatureEnabledForUser("user-OTHER", "demo_data");
    const flat = JSON.stringify(sqlMock.mock.calls);
    expect(flat).toContain("user-OTHER");
  });
});

describe("requireFeatureEnabled", () => {
  it("returns null when the feature is enabled (request may proceed)", async () => {
    sqlMock.mockResolvedValueOnce(prefsRow({ feature_choices: { advanced_analytics: true } }));
    await expect(requireFeatureEnabled(USER, "advanced_analytics")).resolves.toBeNull();
  });

  it("returns 404 (not 403) when the feature is declined", async () => {
    sqlMock.mockResolvedValueOnce(
      prefsRow({ feature_choices: { advanced_analytics: false } }),
    );
    const res = (await requireFeatureEnabled(USER, "advanced_analytics")) as Response;
    expect(res).not.toBeNull();
    expect(res.status).toBe(404);
  });
});
