vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
/**
 * TENANT ISOLATION � GET /api/regions/estimate
 *
 * This route counts leads. The campaign_contacts queries were scoped to the caller's
 * organization, but the four `leads` queries were NOT, so any authenticated tenant
 * received the total number of leads belonging to EVERY other tenant, and � because the
 * route accepts region filters � could use it as a counting oracle to infer where other
 * tenants' leads are located (query by ZIP/state and observe the count change).
 *
 * These tests assert the count is bounded by the caller's own leads in every branch:
 * no regions, include filters, and exclude filters.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const ORG_A = "org-aaaa-0000-0000-000000000001";
const ORG_B = "org-bbbb-0000-0000-000000000002";

let currentOrg = ORG_A;

// Every query text is recorded so the test can assert the org predicate is present,
// and so the mocked result can be scoped the way Postgres would really scope it.
const queries: string[] = [];

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => ({ user: { id: "u1" } })) } },
}));
vi.mock("@/lib/organization-context", () => ({
  getOrganization: vi.fn(async () => ({ id: currentOrg })),
}));
vi.mock("@/app/api/utils/sql", () => {
  // The driver supports two call shapes and this route uses both now:
  //   tagged  -> sql`SELECT ... WHERE a = ${x}`
  //   string  -> sql(text, params)   <- required for dynamic predicates
  // The nested-fragment fix (defect #32) moved the region filters to the string
  // form, so the mock has to understand it or the test would pass vacuously.
  const run = async (
    stringsOrText: TemplateStringsArray | string,
    ...rest: unknown[]
  ) => {
    let text: string;
    let params: unknown[];

    if (typeof stringsOrText === "string") {
      text = stringsOrText;
      params = Array.isArray(rest[0]) ? (rest[0] as unknown[]) : [];
    } else {
      const strings = stringsOrText;
      text = strings.reduce(
        (a, s, i) => a + s + (i < rest.length ? ` $${i + 1} ` : ""),
        ""
      );
      params = rest;
    }

    queries.push(text);
    const orgIdx = params.findIndex((v) => v === ORG_A || v === ORG_B);
    const org = orgIdx === -1 ? null : (params[orgIdx] as string);
    // 3 rows for A, 7 for B -> a global count would be 10.
    const table = /FROM\s+leads/i.test(text) ? "leads" : "campaign_contacts";
    const scoped = org !== null && new RegExp(`${table}[\\s\\S]*?organization_id`, "i").test(text);
    const n = org === ORG_B ? 7 : 3;
    return [{ count: scoped ? n : 10 }];
  };
  const fn: any = run;
  fn.query = run;
  return { default: fn };
});

import { POST } from "../route";

function req(body: unknown) {
  return new Request("http://localhost/api/regions/estimate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function lastLeadsQuery(): string {
  return [...queries].reverse().find((q) => /FROM\s+leads/i.test(q)) ?? "";
}

describe("regions/estimate � tenant isolation", () => {
  beforeEach(() => {
    currentOrg = ORG_A;
    queries.length = 0;
  });

  it("scopes the unfiltered lead count to the caller's organization", async () => {
    const res = await POST(req({ regions: [] }));
    const body = await res.json();
    expect(body.count).toBe(3); // org A's own leads, not 10 (global)
  });

  it("scopes the lead count when include filters are supplied", async () => {
    const res = await POST(req({ regions: [{ type: "ZIP", value: "30301", include: true }] }));
    const body = await res.json();
    expect(body.count).toBe(3);
  });

  it("scopes the lead count when only exclude filters are supplied", async () => {
    const res = await POST(req({ regions: [{ type: "STATE", value: "TX", include: false }] }));
    const body = await res.json();
    expect(body.count).toBe(3);
  });

  it("every leads query carries an organization_id predicate", async () => {
    await POST(req({ regions: [] }));
    await POST(req({ regions: [{ type: "ZIP", value: "30301", include: true }] }));
    await POST(req({ regions: [{ type: "STATE", value: "TX", include: false }] }));

    const leadsQueries = queries.filter((q) => /FROM\s+leads/i.test(q));
    expect(leadsQueries.length).toBeGreaterThan(0);
    for (const q of leadsQueries) {
      expect(q, `unscoped leads query:\n${q}`).toMatch(/organization_id/i);
    }
  });

  it("org B sees its own count, not org A's", async () => {
    currentOrg = ORG_B;
    const res = await POST(req({ regions: [] }));
    const body = await res.json();
    expect(body.count).toBe(7);
  });

  it("rejects an unauthenticated caller", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(null as never);
    const res = await POST(req({ regions: [] }));
    expect(res.status).toBe(401);
  });
});

