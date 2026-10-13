/**
 * Phase 11 — REAL Postgres verification for dashboard slice SQL.
 *
 * WHY THIS FILE EXISTS (defects #38, #40, #43)
 * ----------------------------------------------
 * The dashboard slices were shipping SQL that referenced columns/tables that
 * do not exist on the live database:
 *
 *   * Defect #38: quick-stats query filtered on `message_type = 'inbound'`
 *     on `ai_conversations` — that column has never existed.
 *   * Defect #40: engagements query read non-existent columns and joined
 *     incorrectly; the fix uses real columns: c.lead_id, c.channel,
 *     c.status, c.requires_human, c.confidence_score, c.last_message_at,
 *     c.created_at, l.name, l.metadata->>'address', l.metadata->>'state',
 *     camp.name.
 *   * Defect #43: stats query filtered `audit_logs` on `organization_id` —
 *     that column does not exist; the table has no organization_id column.
 *     The fix scopes through `organization_members` join.
 *
 * Mocked route tests never executed the real SQL, so every green run was
 * compatible with a production 500. This suite boots a real Postgres engine
 * (PGlite), applies the schema, and runs the ACTUAL functions from
 * `dashboardSlices.ts` — proving the shipped SQL executes against the
 * shipped schema.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let db: PGlite;
const ORG = 'org-test-0000000000000000000001';
const USER_ALICE = 'user_alice';

/* ------------------------------------------------------------------ sql mock -- */

interface NeonQueryLike {
  [Symbol.toStringTag]: string;
  parameterizedQuery: { sql: string; params: any[] } | null;
  then: any;
  catch: any;
  finally: any;
}

function makeQuery(text: string, values: any[]): NeonQueryLike {
  const promise = db.query(text, values).then((res: any) =>
    Array.isArray(res?.rows) ? res.rows : Array.from(res?.rows ?? []),
  );
  return {
    [Symbol.toStringTag]: 'NeonQueryPromise' as const,
    parameterizedQuery: { sql: text, params: values },
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: (fn: any) => promise.finally(fn),
  };
}

const sql = ((...args: unknown[]) => {
  if (Array.isArray(args[0])) {
    const strings = args[0] as string[];
    const values = args.slice(1);
    let text = '';
    strings.forEach((s, i) => {
      text += s;
      if (i < values.length) text += `$${i + 1}`;
    });
    return makeQuery(text, values);
  }
  const text = args[0] as string;
  const values = (args[1] ?? []) as any[];
  return makeQuery(text, values);
}) as any;

sql.transaction = async (queries: NeonQueryLike[]): Promise<any[][]> => {
  await db.exec('BEGIN');
  try {
    const results: any[][] = [];
    for (const q of queries) {
      if (q.parameterizedQuery) {
        const res = await db.query(q.parameterizedQuery.sql, q.parameterizedQuery.params);
        results.push(Array.isArray(res?.rows) ? res.rows : Array.from(res?.rows ?? []));
      } else {
        results.push(await (q as any));
      }
    }
    await db.exec('COMMIT');
    return results;
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }
};
sql.query = sql;
sql.unsafe = (rawSql: string) => ({ __unsafeSql: rawSql });

vi.mock('@/app/api/utils/sql', () => ({ default: sql }));

vi.mock('@/app/api/utils/credits', () => ({
  getBalanceDetails: vi.fn().mockResolvedValue({ balance: 100, lifetimePurchased: 200, lifetimeUsed: 100 }),
  getAllCosts: vi.fn().mockResolvedValue({ SMS_SEND: 5, EMAIL_SEND: 1, AI_CLASSIFY: 2 }),
  getTransactionHistory: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/app/api/utils/subscriptionGuard', () => ({
  getSubscriptionStatus: vi.fn().mockResolvedValue({ tier: 'pro' }),
}));
vi.mock('@/app/api/utils/pipelineOrchestrator', () => ({
  getPipelineStatus: vi.fn().mockResolvedValue({ phase: 'live', status: 'healthy' }),
}));
vi.mock('@/app/api/utils/queryFallback', () => ({
  logFallback: () => (rows: any) => rows,
}));
vi.mock('date-fns', () => ({
  formatDistanceToNow: () => 'just now',
}));

const {
  getDashboardStats,
  getDashboardQuickStats,
  getDashboardEngagements,
} = await import('@/app/api/utils/dashboardSlices');

/* ------------------------------------------------------------------ schema -- */

const SCHEMA_PATH = join(process.cwd(), 'db', 'schema.sql');

beforeAll(async () => {
  db = new PGlite();
  await db.waitReady;
  await db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  // schema.sql omits organizations & organization_members (migrations 022/023).
  // Also add organization_id to leads (migration 030) — the dashboard slices
  // filter on leads.organization_id.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS public.organizations (
      id text PRIMARY KEY,
      name text NOT NULL,
      owner_user_id text NOT NULL,
      timezone text NOT NULL DEFAULT 'America/New_York',
      slug text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS public.organization_members (
      id text PRIMARY KEY DEFAULT 'om_' || gen_random_uuid()::text,
      user_id text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
      organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
      role text NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'MANAGER', 'AGENT', 'MEMBER', 'VIEWER')),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(user_id, organization_id)
    );
    ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS organization_id text REFERENCES public.organizations(id);
  `);
}, 30_000);

afterAll(async () => {
  await db.close();
});

async function seedData() {
  await db.exec(`
    INSERT INTO public.organizations (id, name, owner_user_id, timezone, slug)
    VALUES ('${ORG}', 'Test Org', 'system', 'America/New_York', 'test-org')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO public."user" (id, name, email, "emailVerified", role)
    VALUES ('${USER_ALICE}', 'Alice', 'alice@test.com', true, 'MEMBER')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.organization_members (id, user_id, organization_id, role)
    VALUES ('om_1', '${USER_ALICE}', '${ORG}', 'OWNER')
    ON CONFLICT (user_id, organization_id) DO NOTHING;

    INSERT INTO public.leads (id, type, name, email, status, metadata, organization_id, created_at, updated_at)
    VALUES
      (1, 'seller', 'Lead A', 'a@test.com', 'new', '{}'::jsonb, '${ORG}', now(), now()),
      (2, 'seller', 'Lead B', 'b@test.com', 'contacted', '{"propertyValue": 25000000}'::jsonb, '${ORG}', now() - interval '1 day', now() - interval '1 day'),
      (3, 'seller', 'Lead C', 'c@test.com', 'closed', '{"propertyValue": 32000000}'::jsonb, '${ORG}', now() - interval '2 days', now() - interval '1 hour');

    INSERT INTO public.ai_conversations (lead_id, channel, history, status, confidence_score, requires_human, last_message_at, created_at)
    VALUES
      (1, 'sms', '[]'::jsonb, 'active', 0.9, false, now() - interval '2 days', now() - interval '3 days'),
      (3, 'sms', '[]'::jsonb, 'resolved', 0.8, true, now() - interval '1 hour', now() - interval '2 days');

    INSERT INTO public.jobs (type, payload, status, run_at, created_at)
    VALUES
      ('test_job_1', '{"organization_id":"${ORG}"}'::jsonb, 'pending', now(), now());

    INSERT INTO public.audit_logs (user_id, action, target_type, target_id, payload)
    VALUES
      ('${USER_ALICE}', 'lead_create', 'lead', '1', '{}'::jsonb),
      ('${USER_ALICE}', 'campaign_launch', 'campaign', 'camp_1', '{}'::jsonb);
  `);
}

/* ------------------------------------------------------------------ tests -- */

describe('dashboard slices — SQL executes against real schema (defects #38, #40, #43)', () => {
  beforeEach(async () => {
    await db.exec(`
      TRUNCATE public.leads, public.ai_conversations, public.jobs, public.audit_logs
      RESTART IDENTITY CASCADE;
    `);
    await seedData();
  });

  it('getDashboardStats — does not 500 on audit_logs (defect #43: no organization_id)', async () => {
    const result = await getDashboardStats(ORG);
    expect(result).toBeDefined();
    expect(result.totalLeads).toBe(3);
    expect(result.pendingJobs).toBe(1);
    expect(result.auditCount).toBe(2);
    expect(result.requiresHuman).toBe(1);
  });

  it('getDashboardQuickStats — does not 500 on ai_conversations (defect #38: message_type)', async () => {
    const result = await getDashboardQuickStats(ORG);
    expect(result).toBeDefined();
    expect(result.leads).toBeDefined();
    expect(result.contacted).toBeDefined();
    expect(result.responses).toBeDefined();
    expect(result.deals).toBeDefined();
    expect(result.leads.value).toBe(3);
    expect(result.contacted.value).toBe(2);
    expect(result.responses.value).toBe(2);
    expect(result.deals.value).toBe(1);
  });

  it('getDashboardEngagements — does not 500 on column mapping (defect #40)', async () => {
    const result = await getDashboardEngagements(ORG);
    expect(result).toBeDefined();
    expect(result.engagements).toBeDefined();
    expect(Array.isArray(result.engagements)).toBe(true);
    expect(result.engagements.length).toBe(2);
    const hotLead = result.engagements.find((e: any) => e.type === 'hot_lead');
    expect(hotLead).toBeDefined();
    expect(hotLead.leadName).toBe('Lead C');
    const response = result.engagements.find((e: any) => e.type === 'response');
    expect(response).toBeDefined();
    expect(response.leadName).toBe('Lead A');
  });

  it('getDashboardStats returns zero when org has no data (not a 500)', async () => {
    await db.exec(`TRUNCATE public.leads, public.ai_conversations, public.jobs, public.audit_logs RESTART IDENTITY CASCADE;`);
    const result = await getDashboardStats('org-empty-0000000000000000000002');
    expect(result).toBeDefined();
    expect(result.totalLeads).toBe(0);
    expect(result.pendingJobs).toBe(0);
    expect(result.auditCount).toBe(0);
    expect(result.requiresHuman).toBe(0);
  });

  it('getDashboardQuickStats returns zeroed trends when org has no data', async () => {
    await db.exec(`TRUNCATE public.leads, public.ai_conversations, public.jobs, public.audit_logs RESTART IDENTITY CASCADE;`);
    const result = await getDashboardQuickStats('org-empty-0000000000000000000002');
    expect(result).toBeDefined();
    expect(result.leads.value).toBe(0);
    expect(result.contacted.value).toBe(0);
    expect(result.responses.value).toBe(0);
    expect(result.deals.value).toBe(0);
  });

  it('getDashboardEngagements returns empty array when org has no conversations', async () => {
    await db.exec(`TRUNCATE public.leads, public.ai_conversations, public.jobs, public.audit_logs RESTART IDENTITY CASCADE;`);
    const result = await getDashboardEngagements('org-empty-0000000000000000000002');
    expect(result).toBeDefined();
    expect(result.engagements).toEqual([]);
  });
});
