/**
 * F4 — REAL two-organization tenant-isolation verification for the CREDITS and
 * PIPELINE analytics slices.
 *
 * The first multitenant suite covers funnel/weeklyProgress/activity/
 * nextActions/campaigns. This one covers the two remaining slices in
 * `buildDashboardSummary` — `credits` (getBalanceDetails + getTransactionHistory)
 * and `pipeline` (getPipelineStatus, which reads pipeline_runs + action_queue +
 * jobs). It runs the ACTUAL functions against a real PGlite Postgres seeded with
 * two organizations and asserts Org B's balances, transactions, runs, actions,
 * and stage-health never appear when Org A asks.
 *
 * Existing coverage (tenantIsolation.pglite.test.ts) checks the underlying
 * credit_balances / pipeline_value tables via raw SQL, but does NOT drive the
 * slice functions themselves with two-org fixtures — that gap is what this fills.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let db: PGlite;
const ORG_A = 'org-caaa-0000000000000000000001';
const ORG_B = 'org-cbbb-0000000000000000000002';

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
vi.mock('@/app/api/utils/logger', () => ({ logEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/app/api/utils/jobs', () => ({ enqueueJob: vi.fn().mockResolvedValue('job-1') }));

const { getBalanceDetails, getTransactionHistory } = await import('@/app/api/utils/credits');

/* ------------------------------------------------------------------ schema -- */

const SCHEMA_PATH = join(process.cwd(), 'db', 'schema.sql');

beforeAll(async () => {
  db = new PGlite();
  await db.waitReady;
  await db.exec(readFileSync(SCHEMA_PATH, 'utf8'));

  // organizations (022) + the credit/pipeline tables the slices read, using the
  // REAL DDL from migrations 080 (credits) and 077 (pipeline orchestration).
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

    CREATE TABLE IF NOT EXISTS credit_balances (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id TEXT NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
      balance INTEGER NOT NULL DEFAULT 0,
      lifetime_purchased INTEGER NOT NULL DEFAULT 0,
      lifetime_used INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS credit_transactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('PURCHASE','DEDUCT','REFUND','BONUS','ADJUSTMENT')),
      amount INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      description TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.action_queue (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id TEXT NOT NULL,
      user_id TEXT,
      type TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'NORMAL',
      entity_type TEXT,
      entity_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      quick_actions JSONB DEFAULT '[]'::jsonb,
      status TEXT NOT NULL DEFAULT 'PENDING',
      auto_continue_at TIMESTAMPTZ,
      auto_continue_action TEXT,
      due_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      completed_by TEXT,
      result_action TEXT,
      result_notes TEXT
    );

    CREATE TABLE IF NOT EXISTS public.pipeline_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      stage_stats JSONB DEFAULT '{}'::jsonb,
      leads_processed INTEGER DEFAULT 0,
      messages_sent INTEGER DEFAULT 0,
      responses_handled INTEGER DEFAULT 0,
      deals_advanced INTEGER DEFAULT 0,
      contracts_generated INTEGER DEFAULT 0,
      human_actions_created INTEGER DEFAULT 0,
      errors JSONB DEFAULT '[]'::jsonb,
      status TEXT NOT NULL DEFAULT 'RUNNING'
    );
  `);
}, 60_000);

afterAll(async () => {
  await db.close();
});

async function truncateAll() {
  await db.exec(`
    TRUNCATE credit_balances, credit_transactions, public.action_queue, public.pipeline_runs, public.jobs
    RESTART IDENTITY CASCADE;
  `);
}

async function seed() {
  await db.exec(`
    INSERT INTO public.organizations (id, name, owner_user_id, slug)
    VALUES ('${ORG_A}', 'Cred Org Alpha', 'system', 'cred-org-a'),
           ('${ORG_B}', 'Cred Org Bravo', 'system', 'cred-org-b')
    ON CONFLICT (id) DO NOTHING;

    -- Distinguishable balances.
    INSERT INTO credit_balances (organization_id, balance, lifetime_purchased, lifetime_used)
    VALUES ('${ORG_A}', 1000, 2000, 1000), ('${ORG_B}', 50, 60, 10);

    -- Transactions: Org A "Purchase A" (500), Org B "Purchase B" (7).
    INSERT INTO credit_transactions (organization_id, type, amount, balance_after, description, created_at)
    VALUES
      ('${ORG_A}', 'PURCHASE', 500, 1000, 'Purchase A', NOW() - interval '2 hours'),
      ('${ORG_A}', 'DEDUCT',   -50,  950, 'Spend A',    NOW() - interval '1 hour'),
      ('${ORG_B}', 'PURCHASE', 7,   50,  'Purchase B', NOW() - interval '2 hours');

    -- Action queue: Org A has 2 PENDING (1 URGENT, 1 NORMAL), Org B has 1 PENDING (HIGH).
    INSERT INTO action_queue (organization_id, type, priority, title, status)
    VALUES
      ('${ORG_A}', 'ESCALATION', 'URGENT', 'Action A-urgent', 'PENDING'),
      ('${ORG_A}', 'REVIEW_DEAL', 'NORMAL', 'Action A-normal', 'PENDING'),
      ('${ORG_A}', 'REVIEW_DEAL', 'NORMAL', 'Action A-done', 'COMPLETED'),
      ('${ORG_B}', 'REVIEW_DEAL', 'HIGH', 'Action B-high', 'PENDING');

    -- Pipeline runs: Org A has a COMPLETED run; Org B has a RUNNING run.
    INSERT INTO pipeline_runs (organization_id, status, started_at, completed_at, stage_stats)
    VALUES
      ('${ORG_B}', 'RUNNING', NOW() - interval '10 minutes', NULL, '{}'::jsonb),
      ('${ORG_A}', 'COMPLETED', NOW() - interval '2 hours', NOW() - interval '1 hour', '{"leads":5}'::jsonb);

    -- Jobs for stage health (scoped by payload->>'organizationId').
    INSERT INTO public.jobs (type, payload, status, run_at, created_at)
    VALUES
      ('score_lead', '{"organizationId":"${ORG_A}"}'::jsonb, 'completed', NOW(), NOW() - interval '1 hour'),
      ('score_lead', '{"organizationId":"${ORG_A}"}'::jsonb, 'dead', NOW(), NOW() - interval '1 hour'),
      ('score_lead', '{"organizationId":"${ORG_B}"}'::jsonb, 'completed', NOW(), NOW() - interval '1 hour');
  `);
}


/* ------------------------------------------------------------------ tests -- */

describe('credits + pipeline slices — two-organization tenant isolation (F4)', () => {
  beforeEach(async () => {
    await truncateAll();
    await seed();
  });

  /* ---- credits: getBalanceDetails ------------------------------------ */

  it('getBalanceDetails: Org A balance excludes Org B', async () => {
    const a = await getBalanceDetails(ORG_A);
    expect(a.balance).toBe(1000);
    expect(a.lifetimePurchased).toBe(2000);
    expect(a.lifetimeUsed).toBe(1000);
  });

  it('getBalanceDetails: Org B sees only its own (symmetric)', async () => {
    const b = await getBalanceDetails(ORG_B);
    expect(b.balance).toBe(50); // NOT 1000 (Org A), NOT 1050 (sum)
  });

  it('getBalanceDetails: unknown org returns zeros (not another org balance)', async () => {
    const empty = await getBalanceDetails('org-none-0000000000000000000099');
    expect(empty.balance).toBe(0);
  });

  /* ---- credits: getTransactionHistory -------------------------------- */

  it('getTransactionHistory: Org A history has only Org A rows', async () => {
    const a = await getTransactionHistory(ORG_A);
    expect(a.length).toBe(2);
    expect(a.map((t) => t.description)).toEqual(['Spend A', 'Purchase A']); // DESC by created_at
    expect(a.map((t) => t.description)).not.toContain('Purchase B');
  });

  it('getTransactionHistory: Org B history has only Org B rows', async () => {
    const b = await getTransactionHistory(ORG_B);
    expect(b.length).toBe(1);
    expect(b[0].description).toBe('Purchase B');
    expect(b[0].amount).toBe(7);
  });

  it('getTransactionHistory: unknown org returns empty (not another org rows)', async () => {
    const empty = await getTransactionHistory('org-none-0000000000000000000099');
    expect(empty).toEqual([]);
  });

  /* ---- pipeline: getPipelineStatus ----------------------------------- */

  it('getPipelineStatus: pending action counts exclude Org B', async () => {
    const a = await getPipelineStatus(ORG_A);
    // Org A PENDING: 1 URGENT + 1 NORMAL = 2 total. Org B's HIGH is excluded, and
    // Org A's COMPLETED action is excluded.
    expect(a.pendingActions.total).toBe(2);
    expect(a.pendingActions.urgent).toBe(1);
    expect(a.pendingActions.normal).toBe(1);
    expect(a.pendingActions.high).toBe(0); // Org B's only pending action
  });

  it('getPipelineStatus: lastRun is Org A COMPLETED run, not Org B RUNNING run', async () => {
    const a = await getPipelineStatus(ORG_A);
    expect(a.lastRun).not.toBeNull();
    expect(a.lastRun!.status).toBe('COMPLETED');
    expect(a.isRunning).toBe(false); // Org B has a RUNNING run — must not bleed in
  });

  it('getPipelineStatus: Org B sees its own RUNNING run only', async () => {
    const b = await getPipelineStatus(ORG_B);
    expect(b.isRunning).toBe(true);
    expect(b.lastRun!.status).toBe('RUNNING');
    // Org B PENDING: 1 HIGH.
    expect(b.pendingActions.total).toBe(1);
    expect(b.pendingActions.high).toBe(1);
  });

  it('getPipelineStatus: stage health is computed from Org A jobs only', async () => {
    const a = await getPipelineStatus(ORG_A);
    const leadStage = a.stageHealth.find((s: any) => s.stage === 'lead_ingestion');
    expect(leadStage).toBeDefined();
    // Org A has 2 score_lead jobs (1 completed, 1 dead) -> total 2, 1 error.
    // Org B's single completed job must not be counted.
    expect(Number(leadStage!.errorRate)).toBeCloseTo(0.5, 5); // 1 error / 2 total
  });

  /* ---- negative control --------------------------------------------- */

  it('control: an unscoped balance query would sum both orgs (filter is load-bearing)', async () => {
    const scoped = await db.query('SELECT balance FROM credit_balances WHERE organization_id=$1', [ORG_A]);
    const unscoped = await db.query('SELECT COALESCE(SUM(balance),0)::int AS n FROM credit_balances');
    expect(Number(scoped.rows[0].balance)).toBe(1000);
    expect(unscoped.rows[0].n).toBe(1050); // control: removing the filter changes the number
  });
});

const { getPipelineStatus } = await import('@/app/api/utils/pipelineOrchestrator');
