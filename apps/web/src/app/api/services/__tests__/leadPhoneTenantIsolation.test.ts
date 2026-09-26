/**
 * FINDING 13 - tenant-safe lead resolution by phone.
 *
 * The defect: `resolveLeadIdByPhone` resolved `WHERE phone = $1 ORDER BY updated_at DESC
 * LIMIT 1` with no organization filter. A phone number is not a tenant-unique key, so the
 * winner was whichever tenant touched the number most recently - letting inbound SMS,
 * opt-out attribution and deal-outcome recording attach activity to another tenant's lead.
 *
 * The fix is TWO primitives, because the callers are not alike:
 *   1. `resolveLeadIdByPhone(phone, organizationId)` - STRICT, organization REQUIRED, and
 *      it fails closed if the caller forgets to pass one. Used by callers that legitimately
 *      know their tenant.
 *   2. `resolveLeadIdsByPhoneGlobal(phone)` - returns EVERY matching lead. Used only by
 *      provider webhooks (Twilio/SNS) that have no authenticated tenant. It never picks a
 *      single arbitrary tenant, which is what makes attribution symmetric with the
 *      platform-wide TCPA suppression.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn() }));
vi.mock("@/app/api/utils/sql", () => ({ default: mockSql }));

import {
  resolveLeadIdByPhone,
  resolveLeadIdsByPhoneGlobal,
} from "@/app/api/services/stageTransitionRecorder";

const lastQuery = () => (mockSql.mock.calls.at(-1)?.[0] ?? []).join("?");
// A tagged template calls sql(strings, ...values): call[0] is the strings array and the
// bound values are call[1..n]. Slicing call[0] would read the template chunks, not the values.
const argsOf = () => (mockSql.mock.calls.at(-1) ?? []).slice(1);

beforeEach(() => vi.clearAllMocks());

describe("resolveLeadIdByPhone - STRICT tenant-scoped", () => {
  it("KNOWN TENANT: matching phone + correct organization resolves", async () => {
    mockSql.mockResolvedValueOnce([{ id: "lead_a" }]);
    expect(await resolveLeadIdByPhone("+15025550100", "org_a")).toBe("lead_a");
    expect(lastQuery()).toContain("organization_id");
  });

  it("KNOWN TENANT: wrong organization cannot resolve another tenant's lead", async () => {
    // The org predicate is part of the lookup, so org_b is a filter, not a hint: a row
    // belonging to org_a simply does not match.
    mockSql.mockResolvedValueOnce([]);
    expect(await resolveLeadIdByPhone("+15025550100", "org_b")).toBeNull();
    expect(lastQuery()).toContain("organization_id");
  });

  it("the organization value is bound as a query parameter, not interpolated", async () => {
    mockSql.mockResolvedValueOnce([]);
    await resolveLeadIdByPhone("+15025550100", "org_b");
    expect(argsOf()).toContain("org_b");
  });

  it("FAILS CLOSED when no organization is supplied (never degrades to global)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await resolveLeadIdByPhone("+15025550100", "")).toBeNull();
    // The dangerous regression is an unscoped query being issued at all.
    expect(mockSql).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it("malformed / empty phone short-circuits without touching the database", async () => {
    expect(await resolveLeadIdByPhone("", "org_a")).toBeNull();
    expect(await resolveLeadIdByPhone("   ", "org_a")).toBeNull();
    expect(await resolveLeadIdByPhone(null, "org_a")).toBeNull();
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("duplicate phones ACROSS organizations: each org only ever sees its own lead", async () => {
    mockSql.mockResolvedValueOnce([{ id: "lead_a" }]);
    expect(await resolveLeadIdByPhone("+15025550100", "org_a")).toBe("lead_a");
    mockSql.mockResolvedValueOnce([{ id: "lead_b" }]);
    expect(await resolveLeadIdByPhone("+15025550100", "org_b")).toBe("lead_b");
    // Both queries carried a tenant predicate - the distinction is load-bearing.
    for (const call of mockSql.mock.calls) {
      expect((call[0] ?? []).join("?")).toContain("organization_id");
    }
  });

  it("a DB error degrades to null rather than throwing into the caller", async () => {
    mockSql.mockRejectedValueOnce(new Error("connection lost"));
    expect(await resolveLeadIdByPhone("+15025550100", "org_a")).toBeNull();
  });
});

describe("resolveLeadIdsByPhoneGlobal - ambiguity-safe webhook path", () => {
  it("returns EVERY match so attribution mirrors platform-wide suppression", async () => {
    mockSql.mockResolvedValueOnce([{ id: "lead_a" }, { id: "lead_b" }, { id: "lead_c" }]);
    expect(await resolveLeadIdsByPhoneGlobal("+15025550100")).toEqual([
      "lead_a",
      "lead_b",
      "lead_c",
    ]);
  });

  it("never narrows to a single arbitrary tenant (no LIMIT 1)", async () => {
    mockSql.mockResolvedValueOnce([{ id: "a" }, { id: "b" }]);
    await resolveLeadIdsByPhoneGlobal("+15025550100");
    expect(lastQuery()).not.toMatch(/LIMIT\s+1/i);
  });

  it("no matching lead yields an empty set, not a throw", async () => {
    mockSql.mockResolvedValueOnce([]);
    expect(await resolveLeadIdsByPhoneGlobal("+15550000000")).toEqual([]);
  });

  it("empty phone short-circuits", async () => {
    expect(await resolveLeadIdsByPhoneGlobal(null)).toEqual([]);
    expect(await resolveLeadIdsByPhoneGlobal("")).toEqual([]);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("a DB error degrades to an empty set - suppression must never be blocked", async () => {
    mockSql.mockRejectedValueOnce(new Error("down"));
    expect(await resolveLeadIdsByPhoneGlobal("+15025550100")).toEqual([]);
  });

  it("normalises numeric ids to strings so callers compare consistently", async () => {
    mockSql.mockResolvedValueOnce([{ id: 42 }]);
    expect(await resolveLeadIdsByPhoneGlobal("+15025550100")).toEqual(["42"]);
  });
});

describe("the two primitives are not interchangeable", () => {
  it("the strict primitive requires the org; the global one takes none", () => {
    expect(resolveLeadIdByPhone.length).toBe(2);
    expect(resolveLeadIdsByPhoneGlobal.length).toBe(1);
  });
});
