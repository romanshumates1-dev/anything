/**
 * Phase 2 — REAL two-organization tenant-isolation verification for the
 * dashboard analytics slices.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The first PGlite suite (dashboardSlices.pglite.test.ts) proved the shipped SQL
 * *executes* against the real schema (defects #38/#40/#43) and covers
 * stats/quickStats/engagements. It seeds ONE organization, so it cannot detect a
 * cross-tenant leak: a slice that forgot `WHERE organization_id = ...` would
 * still return that single org's rows and pass.
 *
 * This suite seeds TWO organizations with DISTINGUISHABLE data in every table a
 * slice reads (leads, ai_conversations, campaign_lead_queue, message_events,
 * campaign_contacts, outreach_campaigns, campaigns, campaign_leads, contracts,
 * contract_templates) and asserts that when Org A asks for its analytics, NONE
 * of Org B's rows, labels, or derived counts appear. It runs the ACTUAL query
 * functions and joins from dashboardSlices.ts against a real Postgres engine
 * (PGlite) — not mocked return values.
 *
 * The escalation-filter regression is covered here too: `nextActions` query #2 ("Conversations requiring human
 * escalation") must surface ONLY conversations with `requires_human = TRUE`, so
 * a normal conversation in the same org must never be labelled "AI needs
 * assistance".
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let db: PGlite;
const ORG_A = 'org-aaaa-0000000000000000000001';
const ORG_B = 'org-bbbb-0000000000000000000002';

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

// Credits/guard/pipeline are exercised by their own suites; stub them so the
// analytics slices under test load without touching those tables. queryFallback
// is a no-op passthrough so a fallback does not mask a broken slice here.
vi.mock('@/app/api/utils/credits', () => ({
  getBalanceDetails: vi.fn().mockResolvedValue({ balance: 0, lifetimePurchased: 0, lifetimeUsed: 0 }),
  getAllCosts: vi.fn().mockResolvedValue({}),
  getTransactionHistory: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/app/api/utils/subscriptionGuard', () => ({
  getSubscriptionStatus: vi.fn().mockResolvedValue({ tier: 'pro' }),
}));
vi.mock('@/app/api/utils/pipelineOrchestrator', () => ({
  getPipelineStatus: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/app/api/utils/queryFallback', () => ({
  // Real signature: logFallback(label, fallback) returns (error) => fallback.
  // Returning the fallback (not the error) keeps a failing query observable as
  // its declared empty/zero value, exactly as production does.
  logFallback: (_label: string, fallback: any) => () => fallback,
}));
vi.mock('date-fns', () => ({
  formatDistanceToNow: () => 'just now',
}));

const {
  getDashboardStats,
  getDashboardQuickStats,
  getDashboardFunnel,
  getDashboardWeeklyProgress,
  getDashboardActivity,
  getDashboardNextActions,
  getCampaigns,
} = await import('@/app/api/utils/dashboardSlices');

/* ------------------------------------------------------------------ schema -- */

const SCHEMA_PATH = join(process.cwd(), 'db', 'schema.sql');

beforeAll(async () => {
  db = new PGlite();
  await db.waitReady;
  await db.exec(readFileSync(SCHEMA_PATH, 'utf8'));

  // schema.sql omits organizations/organization_members (migrations 022/023) and
  // the organization_id columns added by 030/042. Add them, plus every table the
  // funnel/weeklyProgress/activity/nextActions/campaigns slices read, using the
  // REAL DDL from the migrations that established organization_id + FKs.
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
      role text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(user_id, organization_id)
    );
    ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS organization_id text REFERENCES public.organizations(id);
    -- 081: leads.city — the activity hot-leads query reads COALESCE(l.metadata->>
    -- 'address', l.city, l.name), so the column must exist for that join to run.
    ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS city text;

    -- 042: campaigns / campaign_leads tenant scoping
    ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS organization_id text REFERENCES public.organizations(id);
    ALTER TABLE public.campaign_leads ADD COLUMN IF NOT EXISTS organization_id text REFERENCES public.organizations(id);

    -- outreach_campaigns (campaign-pipeline-schema) — parent of queue/contacts/events
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'campaign_direction') THEN
        CREATE TYPE campaign_direction AS ENUM ('SELLER', 'BUYER');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'campaign_status') THEN
        CREATE TYPE campaign_status AS ENUM ('DRAFT','SCHEDULED','ACTIVE','PAUSED','COMPLETED','CANCELLED');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'contact_status') THEN
        CREATE TYPE contact_status AS ENUM (
          'QUEUED','SENT','FOLLOWED_UP','ENGAGED','NEGOTIATING',
          'AWAITING_OWNER_RANGE','DEAL_AGREED','DEAL_NO_AGREEMENT',
          'CONTRACT_SENT','CONTRACT_SIGNED','OPTED_OUT','COLD','INVALID_NUMBER'
        );
      END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS public.outreach_campaigns (
      id text PRIMARY KEY,
      organization_id text NOT NULL,
      direction campaign_direction NOT NULL,
      name text NOT NULL,
      status campaign_status NOT NULL DEFAULT 'DRAFT',
      daily_volume_min integer NOT NULL DEFAULT 50,
      daily_volume_max integer NOT NULL DEFAULT 100,
      duration_days integer NOT NULL DEFAULT 30,
      start_date timestamptz,
      end_date timestamptz,
      opening_message_id text NOT NULL DEFAULT 'tmpl_default',
      linked_seller_lead_id text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    -- campaign_contacts (campaign-pipeline + 079 property_address + 081 city)
    CREATE TABLE IF NOT EXISTS public.campaign_contacts (
      id text PRIMARY KEY,
      campaign_id text NOT NULL REFERENCES public.outreach_campaigns(id) ON DELETE CASCADE,
      organization_id text NOT NULL,
      name text NOT NULL,
      phone text NOT NULL,
      status contact_status NOT NULL DEFAULT 'QUEUED',
      follow_ups_sent integer NOT NULL DEFAULT 0,
      last_message_at timestamptz,
      last_reply_at timestamptz,
      scheduled_send_at timestamptz,
      opted_out_at timestamptz,
      seller_lead_id text,
      buyer_lead_id text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE public.campaign_contacts ADD COLUMN IF NOT EXISTS property_address text;
    ALTER TABLE public.campaign_contacts ADD COLUMN IF NOT EXISTS city text;
  `);
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeAll(async () => {
  // campaign_lead_queue (051) + message_events (001) + contracts/templates.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS public.campaign_lead_queue (
      id bigserial PRIMARY KEY,
      organization_id text NOT NULL,
      campaign_id text REFERENCES public.outreach_campaigns(id) ON DELETE CASCADE,
      lead_id bigint NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
      expected_value integer NOT NULL,
      p_close numeric(5,4) NOT NULL CHECK (p_close BETWEEN 0 AND 1),
      offer_min integer NOT NULL CHECK (offer_min > 0),
      offer_max integer NOT NULL CHECK (offer_max >= offer_min),
      touch_number integer NOT NULL DEFAULT 0 CHECK (touch_number >= 0 AND touch_number <= 3),
      status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','replied','interested','rejected','dead')),
      scheduled_for timestamptz NOT NULL DEFAULT now(),
      last_sent_at timestamptz,
      last_reply_at timestamptz,
      reply_sentiment text,
      requires_manual_review boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.message_events (
      id text PRIMARY KEY,
      organization_id text NOT NULL,
      campaign_id text NOT NULL REFERENCES public.outreach_campaigns(id) ON DELETE CASCADE,
      contact_id text NOT NULL REFERENCES public.campaign_contacts(id) ON DELETE CASCADE,
      direction text NOT NULL,
      provider text,
      provider_message_id text,
      status text NOT NULL DEFAULT 'queued',
      segment_count integer NOT NULL DEFAULT 1,
      cost_cents integer NOT NULL DEFAULT 0,
      ai_cost_cents integer NOT NULL DEFAULT 0,
      metadata jsonb DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.contract_templates (
      id text PRIMARY KEY,
      organization_id text NOT NULL,
      direction campaign_direction NOT NULL,
      template_body text NOT NULL,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS public.contracts (
      id text PRIMARY KEY,
      organization_id text NOT NULL,
      template_id text NOT NULL REFERENCES public.contract_templates(id),
      direction campaign_direction NOT NULL,
      seller_lead_id text,
      filled_body text NOT NULL,
      pdf_url text,
      status text NOT NULL DEFAULT 'PENDING_SIGNATURE',
      signed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      inspection_days integer NOT NULL DEFAULT 10,
      contract_price_cents bigint,
      assigned_at timestamptz,
      esign_status text CHECK (esign_status IN ('pending','sent','viewed','signed','countersigned')),
      assignment_fee_cents integer
    );
  `);
}, 60_000);


async function truncateAll() {
  await db.exec(`
    TRUNCATE
      public.leads, public.ai_conversations, public.campaigns, public.campaign_leads,
      public.campaign_lead_queue, public.message_events, public.campaign_contacts,
      public.outreach_campaigns, public.contracts, public.contract_templates,
      public.audit_logs, public.jobs
    RESTART IDENTITY CASCADE;
  `);
}

/**
 * Seed TWO orgs with distinguishable data. Every Org A value carries an "A"
 * marker and every Org B value a "B" marker so a leak is trivially detectable
 * by name/description. Timestamps are relative so the 7/30-day windows line up.
 */
async function seedTwoOrgs() {
  await db.exec(`
    INSERT INTO public.organizations (id, name, owner_user_id, slug)
    VALUES ('${ORG_A}', 'Org Alpha', 'system', 'org-alpha'),
           ('${ORG_B}', 'Org Bravo', 'system', 'org-bravo')
    ON CONFLICT (id) DO NOTHING;

    -- Org A leads: id 101..104. Org B leads: id 201..204.
    INSERT INTO public.leads (id, type, name, email, status, metadata, organization_id, created_at, updated_at)
    VALUES
      (101, 'seller', 'Lead A-New',    'a1@test.com', 'new',         '{"address":"A-Addr-New","propertyValue":"100000"}'::jsonb, '${ORG_A}', now() - interval '1 day',  now() - interval '1 day'),
      (102, 'seller', 'Lead A-Contact','a2@test.com', 'contacted',   '{"address":"A-Addr-Contact"}'::jsonb,                       '${ORG_A}', now() - interval '8 days', now() - interval '6 days'),
      (103, 'seller', 'Lead A-Closed', 'a3@test.com', 'closed',      '{"address":"A-Addr-Closed","propertyValue":"300000"}'::jsonb, '${ORG_A}', now() - interval '2 days', now() - interval '1 hour'),
      (104, 'seller', 'Lead A-Nego',   'a4@test.com', 'negotiating', '{"address":"A-Addr-Nego"}'::jsonb,                          '${ORG_A}', now() - interval '1 day',  now() - interval '1 hour'),
      (201, 'seller', 'Lead B-New',    'b1@test.com', 'new',         '{"address":"B-Addr-New","propertyValue":"999999"}'::jsonb, '${ORG_B}', now() - interval '1 day',  now() - interval '1 day'),
      (202, 'seller', 'Lead B-Contact','b2@test.com', 'contacted',   '{"address":"B-Addr-Contact"}'::jsonb,                       '${ORG_B}', now() - interval '8 days', now() - interval '6 days'),
      (203, 'seller', 'Lead B-Closed', 'b3@test.com', 'closed',      '{"address":"B-Addr-Closed","propertyValue":"888888"}'::jsonb, '${ORG_B}', now() - interval '2 days', now() - interval '1 hour'),
      (204, 'seller', 'Lead B-Nego',   'b4@test.com', 'negotiating', '{"address":"B-Addr-Nego"}'::jsonb,                          '${ORG_B}', now() - interval '1 day',  now() - interval '1 hour');

    -- Conversations: Org A lead 103 requires_human=TRUE (genuine escalation),
    -- Org A lead 101 requires_human=FALSE (normal — must NOT be labelled
    -- escalation after the escalation-predicate fix). Org B lead 203 requires_human=TRUE (leak bait).
    INSERT INTO public.ai_conversations (lead_id, channel, history, status, confidence_score, requires_human, last_message_at, created_at)
    VALUES
      (101, 'sms', '[]'::jsonb, 'active',   0.9, false, now() - interval '3 hours', now() - interval '1 day'),
      (103, 'sms', '[]'::jsonb, 'active',   0.8, true,  now() - interval '1 hour',  now() - interval '2 hours'),
      (201, 'sms', '[]'::jsonb, 'active',   0.9, false, now() - interval '3 hours', now() - interval '1 day'),
      (203, 'sms', '[]'::jsonb, 'active',   0.8, true,  now() - interval '1 hour',  now() - interval '2 hours');
  `);
}


/** Outreach/queue/events/campaigns/contracts half of the two-org seed. */
async function seedTwoOrgsPipeline() {
  await db.exec(`
    -- Outreach campaigns (parents) + contacts (for message_events FKs).
    INSERT INTO public.outreach_campaigns (id, organization_id, direction, name, status)
    VALUES ('oc_a', '${ORG_A}', 'SELLER', 'Campaign A', 'ACTIVE'),
           ('oc_b', '${ORG_B}', 'SELLER', 'Campaign B', 'ACTIVE');

    INSERT INTO public.campaign_contacts (id, campaign_id, organization_id, name, phone, status, seller_lead_id, property_address, city)
    VALUES
      ('cc_a', 'oc_a', '${ORG_A}', 'Contact A', '5550000001', 'SENT', '101', 'A-Contact-Addr', 'Austin'),
      ('cc_b', 'oc_b', '${ORG_B}', 'Contact B', '5550000002', 'SENT', '201', 'B-Contact-Addr', 'Boston');

    -- Queue rows: Org A lead 101 sent+replied this week; Org B lead 201 too.
    INSERT INTO public.campaign_lead_queue (organization_id, campaign_id, lead_id, expected_value, p_close, offer_min, offer_max, status, last_sent_at, last_reply_at)
    VALUES
      ('${ORG_A}', 'oc_a', 101, 100000, 0.5, 50000, 90000, 'interested', now() - interval '2 hours', now() - interval '1 hour'),
      ('${ORG_B}', 'oc_b', 201, 100000, 0.5, 50000, 90000, 'interested', now() - interval '2 hours', now() - interval '1 hour');

    -- Message events: Org A has an inbound (response) + a 12 outbound batch today;
    -- Org B has one inbound (leak bait) + no outbound.
    INSERT INTO public.message_events (id, organization_id, campaign_id, contact_id, direction, status, created_at)
    VALUES ('me_a_in', '${ORG_A}', 'oc_a', 'cc_a', 'inbound', 'delivered', now() - interval '30 minutes');
    INSERT INTO public.message_events (id, organization_id, campaign_id, contact_id, direction, status, created_at)
    SELECT 'me_a_out_' || g, '${ORG_A}', 'oc_a', 'cc_a', 'outbound', 'sent', now() - interval '10 minutes'
    FROM generate_series(1, 12) g;
    INSERT INTO public.message_events (id, organization_id, campaign_id, contact_id, direction, status, created_at)
    VALUES ('me_b_in', '${ORG_B}', 'oc_b', 'cc_b', 'inbound', 'delivered', now() - interval '30 minutes');

    -- Legacy campaigns + campaign_leads (042). Org A campaign 1 has 2 leads (1 sent);
    -- Org B campaign 2 has its own leads.
    INSERT INTO public.campaigns (id, name, message_template, status, organization_id, created_at, updated_at)
    VALUES (1, 'Legacy Campaign A', 'Hi {name}', 'launched', '${ORG_A}', now() - interval '3 hours', now() - interval '3 hours'),
           (2, 'Legacy Campaign B', 'Hi {name}', 'launched', '${ORG_B}', now() - interval '3 hours', now() - interval '3 hours');
    INSERT INTO public.campaign_leads (campaign_id, lead_id, status, organization_id)
    VALUES (1, 101, 'sent', '${ORG_A}'), (1, 103, 'pending', '${ORG_A}'),
           (2, 201, 'sent', '${ORG_B}');

    -- Contracts: Org A has one awaiting signature tied to lead 103; Org B one tied to 203.
    INSERT INTO public.contract_templates (id, organization_id, direction, template_body)
    VALUES ('ct_a', '${ORG_A}', 'SELLER', 'body a'), ('ct_b', '${ORG_B}', 'SELLER', 'body b');
    INSERT INTO public.contracts (id, organization_id, template_id, direction, seller_lead_id, filled_body, status, esign_status, created_at)
    VALUES
      ('k_a', '${ORG_A}', 'ct_a', 'SELLER', '103', 'body', 'PENDING_SIGNATURE', 'sent', now() - interval '2 days'),
      ('k_b', '${ORG_B}', 'ct_b', 'SELLER', '203', 'body', 'PENDING_SIGNATURE', 'sent', now() - interval '2 days');
  `);
}


/* ------------------------------------------------------------------ tests -- */

describe('dashboard analytics — two-organization tenant isolation', () => {
  beforeEach(async () => {
    await truncateAll();
    await seedTwoOrgs();
    await seedTwoOrgsPipeline();
  });

  /* ---- stats ---------------------------------------------------------- */

  it('stats: Org A counts never include Org B leads/jobs/audit/human flags', async () => {
    // getDashboardStats has four counters; seed each with a distinguished,
    // per-org row so a leak is an obvious count mismatch rather than 0==0.
    // truncateAll wipes jobs/audit_logs per run; "user" + organization_members
    // persist but are org-keyed, so the empty-org test below stays at zero.
    await db.exec(`
      INSERT INTO public."user" (id, name, email, "emailVerified", role)
      VALUES ('user_a', 'A-User', 'a@stats.user', true, 'MEMBER'),
             ('user_b', 'B-User', 'b@stats.user', true, 'MEMBER')
      ON CONFLICT DO NOTHING;
      INSERT INTO public.organization_members (id, user_id, organization_id, role)
      VALUES ('om_a_stats', 'user_a', '${ORG_A}', 'OWNER'),
             ('om_b_stats', 'user_b', '${ORG_B}', 'OWNER')
      ON CONFLICT DO NOTHING;
      INSERT INTO public.jobs (type, payload, status, run_at, created_at)
      VALUES ('a_job', '{"organization_id":"${ORG_A}"}'::jsonb, 'pending', now(), now()),
             ('b_job', '{"organization_id":"${ORG_B}"}'::jsonb, 'pending', now(), now());
      INSERT INTO public.audit_logs (user_id, action, target_type, target_id, payload)
      VALUES ('user_a', 'lead_create', 'lead', '101', '{}'::jsonb),
             ('user_b', 'lead_create', 'lead', '201', '{}'::jsonb);
    `);

    const a = await getDashboardStats(ORG_A);
    const b = await getDashboardStats(ORG_B);

    // totalLeads: Org A = 101..104 (4); Org B = 201..204 (4); no cross count.
    expect(a.totalLeads).toBe(4);
    expect(b.totalLeads).toBe(4);
    // pendingJobs: scoped via payload->>'organization_id' (defect #43 fix).
    expect(a.pendingJobs).toBe(1);
    expect(b.pendingJobs).toBe(1);
    // auditCount: scoped through organization_members (defect #43 fix), not
    // organization_id on audit_logs (that column does not exist).
    expect(a.auditCount).toBe(1);
    expect(b.auditCount).toBe(1);
    // requiresHuman: each org's flagged conversations only (103 for A, 203 for B).
    expect(a.requiresHuman).toBe(1);
    expect(b.requiresHuman).toBe(1);
  });

  /* ---- quick-stats ----------------------------------------------------- */

  it('quickStats: per-org counts exclude the other org (leads/contacts/responses/deals)', async () => {
    const a = await getDashboardQuickStats(ORG_A);
    const b = await getDashboardQuickStats(ORG_B);
    // Unscoped these would each be 8 leads / 6 contacted / 4 responses / 2 deals
    // (both orgs combined). Scoped, each org sees exactly its own half — proving
    // the organization_id predicate on leads and the leads-subquery on
    // ai_conversations both hold.
    expect(a.leads.value).toBe(4);
    expect(a.contacted.value).toBe(3);
    expect(a.responses.value).toBe(2);
    expect(a.deals.value).toBe(1);
    expect(b.leads.value).toBe(4);
    expect(b.contacted.value).toBe(3);
    expect(b.responses.value).toBe(2);
    expect(b.deals.value).toBe(1);
  });

  /* ---- funnel --------------------------------------------------------- */

  it('funnel: Org A stage counts exclude Org B entirely', async () => {
    const a = await getDashboardFunnel(ORG_A);
    const stage = Object.fromEntries(a.stages.map((s: any) => [s.id, s.count]));
    // Org A has 4 leads in-window (101..104). Org B's 4 must not be counted.
    expect(stage.leads).toBe(4);
    // contacted+ (contacted/negotiating/closed among A): 102,103,104 = 3
    expect(stage.contacted).toBe(3);
    expect(stage.closed).toBe(1); // only A-103
    expect(stage.negotiating).toBe(2); // A-104 (negotiating) + A-103 (closed) both count at this cumulative stage
  });

  it('funnel: Org B sees only its own counts (symmetric check)', async () => {
    const b = await getDashboardFunnel(ORG_B);
    const stage = Object.fromEntries(b.stages.map((s: any) => [s.id, s.count]));
    expect(stage.leads).toBe(4);
    expect(stage.closed).toBe(1); // only B-203
    // avg deal value derives from Org B closed lead only (888888), never A's 300000.
    expect(b.avgDealValue).toBe(888888);
  });

  it('funnel: avg deal value is Org A closed leads only', async () => {
    const a = await getDashboardFunnel(ORG_A);
    expect(a.avgDealValue).toBe(300000); // A-103 propertyValue; B's 888888/999999 excluded
  });

  /* ---- weeklyProgress ------------------------------------------------- */

  it('weeklyProgress: contacted/response counts exclude Org B queue rows', async () => {
    const a = await getDashboardWeeklyProgress(ORG_A);
    // Only Org A lead 101 was sent+replied this week.
    expect(a.leadsContacted).toBe(1);
    expect(a.responsesReceived).toBe(1);
  });

  it('weeklyProgress: streak counts Org A outbound days only', async () => {
    const a = await getDashboardWeeklyProgress(ORG_A);
    // Org A has outbound message_events today -> streak >= 1, and Org B's
    // inbound-only activity does not inflate or deflate it.
    expect(a.streak).toBeGreaterThanOrEqual(1);
  });


  /* ---- activity ------------------------------------------------------- */

  it('activity: feed surfaces only Org A items (names/addresses)', async () => {
    const { activities } = await getDashboardActivity(ORG_A);
    const blob = JSON.stringify(activities);
    expect(blob).toContain('A-'); // Org A markers present somewhere
    expect(blob).not.toContain('B-'); // NO Org B leakage
    expect(blob).not.toContain('Lead B');
    expect(blob).not.toContain('B-Addr');
  });

  it('activity: response_received uses Org A inbound event + contact, not Org B', async () => {
    const { activities } = await getDashboardActivity(ORG_A);
    const responses = activities.filter((x: any) => x.type === 'response_received');
    expect(responses.length).toBe(1);
    expect(responses[0].description).toBe('Contact A');
    expect(responses[0].metadata?.propertyAddress).toBe('A-Contact-Addr');
  });

  it('activity: outreach batch count reflects Org A volume only', async () => {
    const { activities } = await getDashboardActivity(ORG_A);
    const sent = activities.filter((x: any) => x.type === 'message_sent');
    // Org A has 12 outbound today (>=10 threshold); Org B has 0 outbound.
    expect(sent.length).toBe(1);
    expect(sent[0].title).toContain('12 messages sent');
  });

  /* ---- nextActions (escalation-filter) ---------------------------------------------- */

  it('escalation: only requires_human conversations are labelled escalation', async () => {
    const { actions } = await getDashboardNextActions(ORG_A);
    const humanActions = actions.filter((x: any) => x.id.startsWith('human-'));
    // Org A lead 103 requires_human=TRUE -> surfaced. Lead 101 requires_human=
    // FALSE -> must NOT appear as an escalation ("AI needs assistance").
    expect(humanActions.length).toBe(1);
    expect(humanActions[0].id).toBe('human-103');
    expect(humanActions[0].title).toContain('Lead A-Closed');
    // The normal conversation's lead must not be present under any action.
    const blob = JSON.stringify(actions);
    expect(blob).not.toContain('Lead A-New');
  });

  it('nextActions: contract/follow-up actions never reference Org B', async () => {
    const { actions } = await getDashboardNextActions(ORG_A);
    const blob = JSON.stringify(actions);
    expect(blob).not.toContain('Lead B');
    expect(blob).not.toContain('B-Addr');
    // Org A has a contract awaiting signature tied to lead 103.
    const contracts = actions.filter((x: any) => x.type === 'contract');
    expect(contracts.length).toBe(1);
    expect(contracts[0].href).toContain('k_a');
  });

  /* ---- campaigns ------------------------------------------------------ */

  it('campaigns: Org A list contains only Org A campaigns + member counts', async () => {
    const a = await getCampaigns(ORG_A);
    expect(a.length).toBe(1);
    expect(a[0].name).toBe('Legacy Campaign A');
    // member_count comes from the org-pinned join: Org A campaign 1 has 2 leads.
    expect(Number(a[0].member_count)).toBe(2);
    expect(Number(a[0].sent_count)).toBe(1);
  });

  it('campaigns: a cross-org campaign_leads row never inflates Org A member_count', async () => {
    // Insert an Org B campaign_leads row that points at Org A's campaign id (a
    // cross-org reference the org pin must reject). getCampaigns pins the join
    // to cl.organization_id = ORG_A, so this row is excluded; an unpinned join
    // would count it and report 3.
    await db.query(
      `INSERT INTO campaign_leads (campaign_id, lead_id, status, organization_id)
       VALUES (1, 201, 'sent', $1)`,
      [ORG_B],
    );
    const a = await getCampaigns(ORG_A);
    expect(a.length).toBe(1);
    expect(Number(a[0].member_count)).toBe(2); // NOT 3 — the Org B row is excluded
  });

  /* ---- empty org ------------------------------------------------------ */

  it('every slice returns empty/zero for an org with no data (not a leak, not a 500)', async () => {
    const EMPTY = 'org-empty-00000000000000000009';
    const funnel = await getDashboardFunnel(EMPTY);
    expect(funnel.stages.every((s: any) => s.count === 0)).toBe(true);
    expect(funnel.avgDealValue).toBe(0);

    const weekly = await getDashboardWeeklyProgress(EMPTY);
    expect(weekly.leadsContacted).toBe(0);
    expect(weekly.responsesReceived).toBe(0);
    expect(weekly.streak).toBe(0);

    const activity = await getDashboardActivity(EMPTY);
    expect(activity.activities).toEqual([]);

    const next = await getDashboardNextActions(EMPTY);
    expect(next.actions).toEqual([]);

    const campaigns = await getCampaigns(EMPTY);
    expect(campaigns).toEqual([]);
  });
});


/**
 * NEGATIVE CONTROL — proves these tests actually DETECT an unscoped query.
 *
 * Each case runs the scoped vs unscoped form of the same SQL directly against
 * the seeded two-org DB and asserts the unscoped form WOULD surface Org B data
 * (or a non-qualifying row). If the isolation tests above are real, this proves
 * the tenant predicate is what keeps Org B out.
 */
describe('dashboard analytics — negative control (unscoped query leaks Org B)', () => {
  beforeEach(async () => {
    await truncateAll();
    await seedTwoOrgs();
    await seedTwoOrgsPipeline();
  });

  it('leads without organization filter would return both orgs (control)', async () => {
    const scoped = await db.query(`SELECT count(*)::int AS n FROM leads WHERE organization_id = $1`, [ORG_A]);
    const unscoped = await db.query(`SELECT count(*)::int AS n FROM leads`);
    expect(scoped.rows[0].n).toBe(4);
    expect(unscoped.rows[0].n).toBe(8); // control: removing the filter doubles it
  });

  it('ai_conversations without requires_human would include the normal lead (escalation-predicate control)', async () => {
    const withPredicate = await db.query(
      `SELECT l.id FROM ai_conversations c JOIN leads l ON l.id = c.lead_id
       WHERE l.organization_id = $1 AND c.requires_human = TRUE`,
      [ORG_A],
    );
    const withoutPredicate = await db.query(
      `SELECT l.id FROM ai_conversations c JOIN leads l ON l.id = c.lead_id
       WHERE l.organization_id = $1`,
      [ORG_A],
    );
    const withIds = withPredicate.rows.map((r: any) => Number(r.id));
    const withoutIds = withoutPredicate.rows.map((r: any) => Number(r.id));
    expect(withIds).toEqual([103]); // genuine escalation only
    expect(withoutIds).toContain(101); // control: without the predicate, the normal lead leaks in
  });

  it('campaign_leads join without org pin would count a cross-org lead (control)', async () => {
    // Baseline: each org's own campaign_leads. Insert an Org B campaign_leads
    // row that points at Org A's campaign id (a cross-org reference). The
    // org-pinned join (what getCampaigns now uses) excludes it; the unpinned
    // join (the old code) would count it against Org A.
    await db.query(
      `INSERT INTO campaign_leads (campaign_id, lead_id, status, organization_id)
       VALUES (1, 201, 'sent', $1)`,
      [ORG_B],
    );
    const pinned = await db.query(
      `SELECT COUNT(cl.id)::int AS n FROM campaigns c
       LEFT JOIN campaign_leads cl ON cl.campaign_id = c.id AND cl.organization_id = $1
       WHERE c.organization_id = $1 AND c.id = 1`,
      [ORG_A],
    );
    const unpinned = await db.query(
      `SELECT COUNT(cl.id)::int AS n FROM campaigns c
       LEFT JOIN campaign_leads cl ON cl.campaign_id = c.id
       WHERE c.organization_id = $1 AND c.id = 1`,
      [ORG_A],
    );
    expect(pinned.rows[0].n).toBe(2); // pin excludes the Org B row
    expect(unpinned.rows[0].n).toBe(3); // control: unpinned join counts it
  });
});


