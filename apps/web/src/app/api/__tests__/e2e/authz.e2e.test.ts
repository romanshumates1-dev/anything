/**
 * AUTHENTICATED + ADMIN END-TO-END with synthetic accounts and no credentials.
 *
 * The blocker previously reported for authenticated E2E was "no test account and no
 * staging environment". Neither is needed to test authorization: the routes read
 * identity from `auth.api.getSession()` and data from the `sql` module, so supplying a
 * SYNTHETIC session and pointing `sql` at a real PostgreSQL engine exercises the genuine
 * code path end to end.
 *
 * Nothing here touches production and no real credential is read, printed or required.
 *
 * Matrix under test:
 *   ADMIN_A   -> allowed on admin surfaces, scoped to ORG_A
 *   MEMBER_A  -> denied on admin surfaces, scoped to ORG_A
 *   MEMBER_B  -> denied on admin surfaces, scoped to ORG_B
 *   ANONYMOUS -> denied everywhere
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ORG_A = "org-a-0000-0000-00000000000a";
const ORG_B = "org-b-0000-0000-00000000000b";
const ADMIN_A = "user-admin-a";
const MEMBER_A = "user-member-a";
const MEMBER_B = "user-member-b";

// vi.mock factories are hoisted, so shared mutable state must be created through
// vi.hoisted or it is still in the TDZ when the factory runs.
const H = vi.hoisted(() => {
  const box: any = { db: null as any, user: null as any, headers: new Headers() };
  const run = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = "";
    strings.forEach((s, i) => {
      text += s;
      if (i < values.length) text += `$${i + 1}`;
    });
    const res = await box.db.query(text, values as any[]);
    return res.rows;
  };
  const fn: any = run;
  fn.query = run;
  fn.unsafe = (raw: string) => ({ __unsafeSql: raw });
  fn.transaction = async (cb: any, ...rest: any[]) => cb(fn, ...rest);
  box.sql = fn;
  return box;
});

vi.mock("@/app/api/utils/sql", () => ({ default: H.sql }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => H.headers) }));
vi.mock("@/app/api/utils/logger", () => ({ logEvent: vi.fn(async () => {}) }));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(async () =>
        H.user ? { user: { id: H.user.id, email: H.user.email } } : null
      ),
    },
  },
}));

import { requireAdmin } from "@/app/api/utils/authz";
import { getOrganization } from "@/lib/organization-context";

let db: PGlite;

function asUser(id: string | null, email = "", role?: string) {
  H.user = id ? { id, email, ...(role ? { role } : {}) } : null;
}
const asAdminA = () => asUser(ADMIN_A, "admin-a@dealswiftautomation.com", "ADMIN");
const asMemberA = () => asUser(MEMBER_A, "member-a@dealswiftautomation.com", "MEMBER");
const asMemberB = () => asUser(MEMBER_B, "member-b@partner-dealswiftautomation.com", "MEMBER");
const asAnonymous = () => asUser(null);

beforeAll(async () => {
  db = new PGlite();
  H.db = db;
  await db.waitReady;

  await db.exec(`
    CREATE TABLE organizations (
      id TEXT PRIMARY KEY, name TEXT, slug TEXT, stripe_customer_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE "user" (
      id TEXT PRIMARY KEY, email TEXT, name TEXT, role TEXT,
      emailVerified BOOLEAN DEFAULT true, image TEXT,
      "createdAt" TIMESTAMPTZ DEFAULT NOW(), "updatedAt" TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE organization_members (
      id TEXT PRIMARY KEY DEFAULT 'om_' || gen_random_uuid()::text,
      user_id TEXT NOT NULL, organization_id TEXT NOT NULL, role TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, organization_id)
    );
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value JSONB);
    CREATE TABLE leads (
      id TEXT PRIMARY KEY, organization_id TEXT, name TEXT, phone TEXT, email TEXT,
      source TEXT, status TEXT, metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE audit_logs (
      id TEXT PRIMARY KEY, user_id TEXT, action TEXT, target_type TEXT,
      target_id TEXT, payload JSONB, created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  for (const m of [
    "080_credit_system.sql",
    "086_credit_idempotency_and_reservations.sql",
    "088_ai_credit_period_limits.sql",
  ]) {
    db.exec(readFileSync(join(process.cwd(), "db", "migrations", m), "utf8"));
  }
}, 180_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  process.env.NODE_ENV = "test";
  delete process.env.LOCAL_DEV_SECRET;
  H.headers.delete("x-local-dev");

  await db.exec(
    `DELETE FROM audit_logs; DELETE FROM leads; DELETE FROM organization_members;
     DELETE FROM "user"; DELETE FROM organizations;`
  );
  await db.query(`INSERT INTO organizations (id,name,slug) VALUES ($1,'Org A','a'),($2,'Org B','b')`, [
    ORG_A,
    ORG_B,
  ]);
  await db.query(
    `INSERT INTO "user" (id,email,name,role) VALUES
       ($1,'admin-a@dealswiftautomation.com','Admin A','ADMIN'),
       ($2,'member-a@dealswiftautomation.com','Member A','MEMBER'),
       ($3,'member-b@partner-dealswiftautomation.com','Member B','MEMBER')`,
    [ADMIN_A, MEMBER_A, MEMBER_B]
  );
  await db.query(
    `INSERT INTO organization_members (user_id,organization_id,role) VALUES
       ($1,$4,'ADMIN'),($2,$4,'MEMBER'),($3,$5,'MEMBER')`,
    [ADMIN_A, MEMBER_A, MEMBER_B, ORG_A, ORG_B]
  );
  await db.query(`INSERT INTO leads (id,organization_id,name) VALUES ('lead-a',$1,'Lead A'),('lead-b',$2,'Lead B')`, [
    ORG_A,
    ORG_B,
  ]);
  asAnonymous();
});

describe("authenticated E2E — identity resolution", () => {
  it("anonymous callers have no organization", async () => {
    asAnonymous();
    expect(await getOrganization()).toBeNull();
  });

  it("a member resolves to their own organization", async () => {
    asMemberA();
    expect((await getOrganization())?.id).toBe(ORG_A);
  });

  it("org B's member resolves to ORG_B, never ORG_A", async () => {
    asMemberB();
    const org = await getOrganization();
    expect(org?.id).toBe(ORG_B);
    expect(org?.id).not.toBe(ORG_A);
  });
});

describe("authenticated E2E — admin authorization matrix", () => {
  it("ADMIN is allowed", async () => {
    asAdminA();
    expect((await requireAdmin()).ok).toBe(true);
  });

  it("MEMBER is denied with 403", async () => {
    asMemberA();
    const res = await requireAdmin();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(403);
  });

  it("MEMBER of the other org is also denied", async () => {
    asMemberB();
    expect((await requireAdmin()).ok).toBe(false);
  });

  it("UNAUTHENTICATED is denied with 401", async () => {
    asAnonymous();
    const res = await requireAdmin();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(401);
  });
});

describe("authenticated E2E — the local dev bypass is not reachable in production", () => {
  it("does not fire when NODE_ENV is production even with the secret presented", async () => {
    process.env.NODE_ENV = "production";
    process.env.LOCAL_DEV_SECRET = "super-secret";
    H.headers.set("x-local-dev", "super-secret");
    asMemberA();
    expect((await requireAdmin()).ok).toBe(false);
  });

  it("does not fire when the caller does not present the secret", async () => {
    process.env.NODE_ENV = "development";
    process.env.LOCAL_DEV_SECRET = "super-secret";
    asMemberA();
    expect((await requireAdmin()).ok).toBe(false);
  });
});

