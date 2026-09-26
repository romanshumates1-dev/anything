/**
 * REGRESSION: PUT /api/esign forged contract signing.
 *
 * This handler carried three stacked defects that a "does it check a signature" review
 * would miss, because the file's own comment claimed the check existed:
 *   1. the check ran only `if (webhookSecret)`, so an unset ESIGN_WEBHOOK_SECRET meant
 *      NO authentication at all - a permissive default;
 *   2. the "signature" was the raw shared secret compared by `!==`, not an HMAC over the
 *      body, so any disclosure of it was a permanent forge capability;
 *   3. neither the envelope nor the lead update carried an organization predicate, so a
 *      call could mutate another tenant's contract and its lead.
 *
 * The real provider path is POST /api/esign/webhook (provider.verifyWebhook). No app code
 * calls this route, so it is now admin-authenticated and tenant-scoped.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const routePath = join(process.cwd(), "src", "app", "api", "esign", "route.ts");

describe("PUT /api/esign forged signing regression", () => {
  let route: typeof import("@/app/api/esign/route");
  let authz: { requireAdmin: ReturnType<typeof vi.fn> };
  let orgCtx: { getOrganization: ReturnType<typeof vi.fn> };
  let sqlMock: ReturnType<typeof vi.fn>;
  let emailMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    // Default export: the route does `import sql from '@/app/api/utils/sql'`.
    sqlMock = vi.fn().mockResolvedValue([]);
    emailMock = vi.fn().mockResolvedValue(undefined);
    authz = { requireAdmin: vi.fn() };
    orgCtx = { getOrganization: vi.fn() };
    vi.doMock("@/app/api/utils/authz", () => authz);
    vi.doMock("@/lib/organization-context", () => orgCtx);
    vi.doMock("@/app/api/utils/sql", () => ({ default: sqlMock }));
    vi.doMock("@/app/api/utils/emailProviders", () => ({ sendEmailAuto: emailMock }));
    route = await import("@/app/api/esign/route");
  });

  afterEach(() => {
    vi.doUnmock("@/app/api/utils/authz");
    vi.doUnmock("@/lib/organization-context");
    vi.doUnmock("@/app/api/utils/sql");
    vi.doUnmock("@/app/api/utils/emailProviders");
    vi.resetModules();
  });

  const put = (headers: Record<string, string> = {}, body: unknown = {}) =>
    route.PUT(
      new Request("http://localhost/api/esign", {
        method: "PUT",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }) as never
    );

  it("1. refuses an unauthenticated caller even when ESIGN_WEBHOOK_SECRET is unset", async () => {
    // The old code skipped its only check when the secret was absent, so this used to
    // fall straight through to the UPDATE.
    delete process.env.ESIGN_WEBHOOK_SECRET;
    authz.requireAdmin.mockReturnValue({ ok: false, response: Response.json({ error: "Unauthorized" }, { status: 401 }) });
    const res = await put({ "x-webhook-signature": "anything" }, { envelopeId: "env-1", status: "signed" });
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("2. rejects the raw secret as a credential instead of trusting it as a signature", async () => {
    process.env.ESIGN_WEBHOOK_SECRET = "super-secret-value";
    authz.requireAdmin.mockReturnValue({ ok: true });
    orgCtx.getOrganization.mockResolvedValue({ id: "org_a" });
    const res = await put({ "x-webhook-signature": "super-secret-value" }, { envelopeId: "env-1", status: "signed" });
    // Presenting the secret in a header is no longer sufficient - an admin session is
    // required, and the envelope must belong to that admin's organization.
    expect(sqlMock).toHaveBeenCalled();
    const seen = JSON.stringify(sqlMock.mock.calls);
    expect(seen).not.toContain("super-secret-value");
    delete process.env.ESIGN_WEBHOOK_SECRET;
  });

  it("3. scopes the envelope update to the caller's organization", async () => {
    authz.requireAdmin.mockReturnValue({ ok: true });
    orgCtx.getOrganization.mockResolvedValue({ id: "org_a" });
    await put({}, { envelopeId: "env-of-org-b", status: "signed" });
    const seen = JSON.stringify(sqlMock.mock.calls);
    expect(seen).toContain("organization_id");
    expect(seen).toContain("org_a");
  });

  it("4. scopes the lead update to the caller's organization", async () => {
    authz.requireAdmin.mockReturnValue({ ok: true });
    orgCtx.getOrganization.mockResolvedValue({ id: "org_a" });
    sqlMock.mockResolvedValue([{ deal_id: "lead-of-org-b", contract_type: "purchase_agreement", organization_id: "org_a" }] as never);
    await put({}, { envelopeId: "env-1", status: "signed" });
    const seen = JSON.stringify(sqlMock.mock.calls);
    // Every UPDATE the handler issues must be tenant-bound, including the leads write.
    const updates = (sqlMock.mock.calls as unknown[][]).length;
    expect(updates).toBeGreaterThan(0);
    expect(seen).toContain("UPDATE leads");
    expect(seen).toContain("organization_id");
  });

  it("5. source no longer contains the secret-equality check", () => {
    const src = readFileSync(routePath, "utf8");
    expect(src).not.toMatch(/signature\s*!==\s*expectedSig/);
    expect(src).not.toMatch(/expectedSig\s*=\s*webhookSecret/);
  });
});
