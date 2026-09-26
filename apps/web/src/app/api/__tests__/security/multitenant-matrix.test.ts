/**
 * MULTI-TENANT ISOLATION MATRIX TEST SUITE
 *
 * Exercises core HTTP API route handlers with synthetic Org A and Org B accounts:
 * - Leads CRUD (/api/leads/[id])
 * - Campaigns CRUD (/api/campaigns/[id])
 * - Saved Territories (/api/territories/[id])
 * - Pipeline Action Queue (/api/actions/[id])
 * - Autonomous Closing Portal (/api/portal/closing)
 *
 * Verifies strict tenant isolation:
 * - Reading another tenant's resource yields 404 (anti-oracle parity)
 * - Mutating another tenant's resource yields 404 with zero state change
 * - Deleting another tenant's resource yields 404 with zero state change
 * - Valid operations scoped to the caller's organization succeed (200 OK)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { NextRequest } from 'next/server';

const ORG_A = 'org-aaaa-0000-0000-000000000001';
const ORG_B = 'org-bbbb-0000-0000-000000000002';
const USER_A = 'user-admin-a';
const USER_B = 'user-admin-b';

const H = vi.hoisted(() => {
  const box: any = {
    db: null as any,
    currentOrg: null as { id: string; name: string } | null,
    currentUser: null as { id: string; email: string; role: string } | null,
    headers: new Headers(),
  };

  const run = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = '';
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

vi.mock('@/app/api/utils/sql', () => ({ default: H.sql }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => H.headers) }));
vi.mock('@/app/api/utils/logger', () => ({ logEvent: vi.fn(async () => {}) }));
vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(async () =>
        H.currentUser
          ? { user: { id: H.currentUser.id, email: H.currentUser.email, role: H.currentUser.role } }
          : null
      ),
    },
  },
}));
vi.mock('@/lib/organization-context', () => ({
  getOrganization: vi.fn(async () => H.currentOrg),
}));
vi.mock('@/app/api/utils/authz', () => ({
  requireSession: vi.fn(async () => {
    if (!H.currentUser) {
      return { ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) };
    }
    return { ok: true, session: { user: H.currentUser } };
  }),
  requireAdmin: vi.fn(async () => {
    if (!H.currentUser) {
      return { ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) };
    }
    if (H.currentUser.role !== 'ADMIN') {
      return { ok: false, response: Response.json({ error: 'Forbidden' }, { status: 403 }) };
    }
    return { ok: true, session: { user: H.currentUser } };
  }),
}));
vi.mock('@/app/api/utils/rateLimit', () => ({
  rateLimitByUser: vi.fn(async () => ({ allowed: true, remaining: 100 })),
}));
vi.mock('@/app/api/utils/pipelineOrchestrator', () => ({
  completeAction: vi.fn(async () => {}),
  skipAction: vi.fn(async () => {}),
}));
vi.mock('@/app/api/utils/jobs', () => ({
  enqueueJob: vi.fn(async () => {}),
}));

// Route imports
import { GET as leadGET, PATCH as leadPATCH } from '@/app/api/leads/[id]/route';
import { GET as campaignGET, PATCH as campaignPATCH } from '@/app/api/campaigns/[id]/route';
import { GET as territoryGET, PATCH as territoryPATCH, DELETE as territoryDELETE } from '@/app/api/territories/[id]/route';
import { GET as actionGET, POST as actionPOST } from '@/app/api/actions/[id]/route';
import { GET as closingGET, POST as closingPOST } from '@/app/api/portal/closing/route';

let db: PGlite;

function setTenant(tenant: 'A' | 'B' | null) {
  if (tenant === 'A') {
    H.currentOrg = { id: ORG_A, name: 'Organization A' };
    H.currentUser = { id: USER_A, email: 'admin@org-a.com', role: 'ADMIN' };
  } else if (tenant === 'B') {
    H.currentOrg = { id: ORG_B, name: 'Organization B' };
    H.currentUser = { id: USER_B, email: 'admin@org-b.com', role: 'ADMIN' };
  } else {
    H.currentOrg = null;
    H.currentUser = null;
  }
}

function req(url: string, method = 'GET', body?: unknown): NextRequest {
  const init: RequestInit = { method };
  if (body) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  return new NextRequest(new URL(url, 'http://localhost:3000'), init);
}
beforeAll(async () => {
  db = new PGlite();
  H.db = db;
  await db.waitReady;

  await db.exec(`
    CREATE TABLE organizations (
      id TEXT PRIMARY KEY,
      name TEXT
    );
    CREATE TABLE leads (
      id TEXT PRIMARY KEY,
      organization_id TEXT,
      name TEXT,
      email TEXT,
      phone TEXT,
      type TEXT,
      status TEXT,
      address TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      ai_paused BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE ai_conversations (
      id TEXT PRIMARY KEY,
      lead_id TEXT
    );
    CREATE TABLE campaign_leads (
      id TEXT PRIMARY KEY,
      campaign_id INT,
      lead_id TEXT
    );
    CREATE TABLE campaigns (
      id SERIAL PRIMARY KEY,
      organization_id TEXT,
      name TEXT,
      message_template TEXT,
      status TEXT,
      config JSONB,
      settings JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE saved_territories (
      id TEXT PRIMARY KEY,
      organization_id TEXT,
      name TEXT,
      description TEXT,
      regions JSONB,
      region_count INT,
      estimated_leads INT,
      color TEXT,
      is_default BOOLEAN DEFAULT false,
      times_used INT DEFAULT 0,
      last_used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE action_queue (
      id TEXT PRIMARY KEY,
      organization_id TEXT,
      entity_type TEXT,
      entity_id TEXT,
      action TEXT,
      status TEXT,
      title TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE closings (
      id TEXT PRIMARY KEY,
      lead_id TEXT,
      portal_access_token TEXT,
      portal_token_expires_at TIMESTAMPTZ,
      status TEXT,
      closing_date TEXT,
      disbursement_method TEXT,
      disbursement_sent BOOLEAN DEFAULT false,
      docs_received BOOLEAN DEFAULT false,
      title_clear BOOLEAN DEFAULT false,
      notary_scheduled BOOLEAN DEFAULT false
    );
    CREATE TABLE property_valuations (
      id TEXT PRIMARY KEY,
      lead_id TEXT,
      offer_cents INT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec(`
    DELETE FROM property_valuations;
    DELETE FROM closings;
    DELETE FROM action_queue;
    DELETE FROM saved_territories;
    DELETE FROM campaigns;
    DELETE FROM campaign_leads;
    DELETE FROM ai_conversations;
    DELETE FROM leads;
    DELETE FROM organizations;
  `);

  await db.query(`INSERT INTO organizations (id, name) VALUES ($1, 'Org A'), ($2, 'Org B')`, [
    ORG_A,
    ORG_B,
  ]);

  // Seed Org A
  await db.query(
    `INSERT INTO leads (id, organization_id, name, type, status, phone) VALUES ('lead-a', $1, 'Lead Alpha', 'seller', 'new', '+15025550001')`,
    [ORG_A]
  );
  await db.query(
    `INSERT INTO campaigns (id, organization_id, name, status) VALUES (101, $1, 'Campaign Alpha', 'draft')`,
    [ORG_A]
  );
  await db.query(
    `INSERT INTO saved_territories (id, organization_id, name) VALUES ('terr-a', $1, 'Territory Alpha')`,
    [ORG_A]
  );
  await db.query(
    `INSERT INTO action_queue (id, organization_id, action, status, title) VALUES ('act-a', $1, 'call', 'PENDING', 'Call Lead Alpha')`,
    [ORG_A]
  );
  await db.query(
    `INSERT INTO closings (id, lead_id, status) VALUES ('close-a', 'lead-a', 'pending_docs')`,
    []
  );

  // Seed Org B
  await db.query(
    `INSERT INTO leads (id, organization_id, name, type, status, phone) VALUES ('lead-b', $1, 'Lead Beta', 'seller', 'new', '+15025550002')`,
    [ORG_B]
  );
  await db.query(
    `INSERT INTO campaigns (id, organization_id, name, status) VALUES (202, $1, 'Campaign Beta', 'draft')`,
    [ORG_B]
  );
  await db.query(
    `INSERT INTO saved_territories (id, organization_id, name) VALUES ('terr-b', $1, 'Territory Beta')`,
    [ORG_B]
  );
  await db.query(
    `INSERT INTO action_queue (id, organization_id, action, status, title) VALUES ('act-b', $1, 'call', 'PENDING', 'Call Lead Beta')`,
    [ORG_B]
  );
  await db.query(
    `INSERT INTO closings (id, lead_id, status) VALUES ('close-b', 'lead-b', 'pending_docs')`,
    []
  );

  setTenant('A');
});
describe('Multi-Tenant Isolation Matrix — Leads API', () => {
  it('Org A can read its own lead', async () => {
    setTenant('A');
    const res = await leadGET(req('http://localhost:3000/api/leads/lead-a'), {
      params: Promise.resolve({ id: 'lead-a' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe('Lead Alpha');
  });

  it('Org A CANNOT read Org B lead (returns 404 anti-oracle)', async () => {
    setTenant('A');
    const res = await leadGET(req('http://localhost:3000/api/leads/lead-b'), {
      params: Promise.resolve({ id: 'lead-b' }),
    });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe('Lead not found');
  });

  it('Org B CANNOT read Org A lead (returns 404 anti-oracle)', async () => {
    setTenant('B');
    const res = await leadGET(req('http://localhost:3000/api/leads/lead-a'), {
      params: Promise.resolve({ id: 'lead-a' }),
    });
    expect(res.status).toBe(404);
  });

  it('Org A CANNOT mutate Org B lead', async () => {
    setTenant('A');
    const res = await leadPATCH(
      req('http://localhost:3000/api/leads/lead-b', 'PATCH', { name: 'Hacked Beta' }),
      { params: Promise.resolve({ id: 'lead-b' }) }
    );
    expect(res.status).toBe(404);

    // Verify Org B lead is unchanged in DB
    const check = await db.query(`SELECT name FROM leads WHERE id = 'lead-b'`);
    expect(check.rows[0].name).toBe('Lead Beta');
  });
});

describe('Multi-Tenant Isolation Matrix — Campaigns API', () => {
  it('Org A can read its own campaign', async () => {
    setTenant('A');
    const res = await campaignGET(req('http://localhost:3000/api/campaigns/101'), {
      params: Promise.resolve({ id: '101' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe('Campaign Alpha');
  });

  it('Org A CANNOT read Org B campaign (returns 404)', async () => {
    setTenant('A');
    const res = await campaignGET(req('http://localhost:3000/api/campaigns/202'), {
      params: Promise.resolve({ id: '202' }),
    });
    expect(res.status).toBe(404);
  });

  it('Org B CANNOT read Org A campaign (returns 404)', async () => {
    setTenant('B');
    const res = await campaignGET(req('http://localhost:3000/api/campaigns/101'), {
      params: Promise.resolve({ id: '101' }),
    });
    expect(res.status).toBe(404);
  });

  it('Org A CANNOT mutate Org B campaign', async () => {
    setTenant('A');
    const res = await campaignPATCH(
      req('http://localhost:3000/api/campaigns/202', 'PATCH', { name: 'Hijacked Campaign' }),
      { params: Promise.resolve({ id: '202' }) }
    );
    expect(res.status).toBe(404);

    const check = await db.query(`SELECT name FROM campaigns WHERE id = 202`);
    expect(check.rows[0].name).toBe('Campaign Beta');
  });
});

describe('Multi-Tenant Isolation Matrix — Territories API', () => {
  it('Org A CANNOT read Org B territory', async () => {
    setTenant('A');
    const res = await territoryGET(req('http://localhost:3000/api/territories/terr-b'), {
      params: Promise.resolve({ id: 'terr-b' }),
    });
    expect(res.status).toBe(404);
  });

  it('Org A CANNOT update Org B territory', async () => {
    setTenant('A');
    const res = await territoryPATCH(
      req('http://localhost:3000/api/territories/terr-b', 'PATCH', { name: 'Compromised Territory' }),
      { params: Promise.resolve({ id: 'terr-b' }) }
    );
    expect(res.status).toBe(404);

    const check = await db.query(`SELECT name FROM saved_territories WHERE id = 'terr-b'`);
    expect(check.rows[0].name).toBe('Territory Beta');
  });

  it('Org A CANNOT delete Org B territory', async () => {
    setTenant('A');
    const res = await territoryDELETE(req('http://localhost:3000/api/territories/terr-b', 'DELETE'), {
      params: Promise.resolve({ id: 'terr-b' }),
    });
    expect(res.status).toBe(404);

    const check = await db.query(`SELECT id FROM saved_territories WHERE id = 'terr-b'`);
    expect(check.rows.length).toBe(1);
  });
});

describe('Multi-Tenant Isolation Matrix — Action Queue API', () => {
  it('Org A CANNOT read Org B action', async () => {
    setTenant('A');
    const res = await actionGET(req('http://localhost:3000/api/actions/act-b'), {
      params: Promise.resolve({ id: 'act-b' }),
    });
    expect(res.status).toBe(404);
  });

  it('Org A CANNOT execute action belonging to Org B', async () => {
    setTenant('A');
    const res = await actionPOST(
      req('http://localhost:3000/api/actions/act-b', 'POST', { action: 'complete' }),
      { params: Promise.resolve({ id: 'act-b' }) }
    );
    expect(res.status).toBe(404);
  });
});

describe('Multi-Tenant Isolation Matrix — Closing Portal API (Session-Based Auth)', () => {
  it('Org A CANNOT view Org B closing portal (returns 404 Lead not found)', async () => {
    setTenant('A');
    const res = await closingGET(req('http://localhost:3000/api/portal/closing?leadId=lead-b'));
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe('Lead not found');
  });

  it('Org A CANNOT update Org B closing portal (returns 404 Lead not found)', async () => {
    setTenant('A');
    const res = await closingPOST(
      req('http://localhost:3000/api/portal/closing', 'POST', {
        leadId: 'lead-b',
        action: 'upload_docs',
        data: {},
      })
    );
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe('Lead not found');
  });

  it('Org A CAN view its own closing portal (200 OK)', async () => {
    setTenant('A');
    const res = await closingGET(req('http://localhost:3000/api/portal/closing?leadId=lead-a'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.closing.leadId).toBe('lead-a');
  });
});
