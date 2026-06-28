import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flows, flowKeys } from './registry';

// ---- Shared mocks (mirror endpoints.contract.test.ts) ----
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));

const getSession = vi.fn();
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: (...a: any[]) => getSession(...a) } },
}));

const sqlMock: any = vi.fn(async () => []);
sqlMock.transaction = vi.fn(async () => []);
vi.mock('@/app/api/utils/sql', () => ({ default: sqlMock }));

vi.mock('@/app/api/utils/logger', () => ({
  logEvent: vi.fn(async () => {}),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const enqueueJob = vi.fn(async (..._a: any[]) => 1);
vi.mock('@/app/api/utils/jobs', () => ({ enqueueJob: (...a: any[]) => enqueueJob(...a) }));

const sendMessage = vi.fn(async (..._a: any[]) => ({ status: 'sent', delivery: 'mock' }));
vi.mock('@/app/api/utils/messaging', () => ({ sendMessage: (...a: any[]) => sendMessage(...a) }));

const checkConsent = vi.fn(async () => true);
vi.mock('@/app/api/utils/compliance', () => ({ checkConsent, registerOptOut: vi.fn() }));

// ---- Import REAL handlers + utilities the registry binds to ----
import * as leads from '../../leads/route';
import * as campaigns from '../../campaigns/route';
import * as campaignLeads from '../../campaigns/[id]/leads/route';
import * as launch from '../../campaigns/[id]/launch/route';
import * as jobsProcess from '../../jobs/process/route';
import * as conversations from '../../conversations/route';
import * as inbound from '../../sms/inbound/route';
import * as thread from '../../conversations/[leadId]/route';
import * as bulk from '../../leads/bulk/route';
import * as imports from '../../imports/route';
import { parseLeadsCsv, dedupeInBatch, chunk } from '../../utils/ingestion';
import { enqueueJob as realEnqueue } from '../../utils/jobs';

// Map registry `binds` → real symbol, proving Layer A (code exists).
const BINDINGS: Record<string, unknown> = {
  'leads.POST': leads.POST,
  'campaigns.POST': campaigns.POST,
  'campaignLeads.POST': campaignLeads.POST,
  'launch.POST': launch.POST,
  'jobsProcess.POST': jobsProcess.POST,
  'conversations.GET': conversations.GET,
  'inbound.POST': inbound.POST,
  'thread.GET': thread.GET,
  'bulk.POST': bulk.POST,
  'imports.GET': imports.GET,
  parseLeadsCsv,
  dedupeInBatch,
  chunk,
  enqueueJob: realEnqueue,
};

function jsonReq(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sqlMock.mockResolvedValue([]);
  getSession.mockResolvedValue({ user: { id: 'u1' } });
  process.env.JOB_RUNNER_SECRET = 'test-job';
  process.env.SMS_INBOUND_SECRET = 'test-sms';
});

// ---- Layer A: every registry step binds to executable code ----
describe('LAYER A — code exists for every flow step', () => {
  for (const key of flowKeys) {
    const flow = flows[key];
    it(`${key}: all ${flow.steps.length} steps resolve to a real symbol`, () => {
      for (const step of flow.steps) {
        expect(BINDINGS[step.binds], `missing binding for ${step.binds}`).toBeTypeOf('function');
      }
    });
  }
});

// ---- Layer B: behavior works (status codes + downstream effects) ----
describe('LAYER B — campaign_lifecycle behavior', () => {
  it('create_lead: 200 + insert when authed', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 1, name: 'Acme', type: 'seller', phone: '+15555550100' }]);
    const res = await leads.POST(jsonReq('http://t/api/leads', { name: 'Acme', type: 'seller' }));
    expect(res.status).toBe(200);
  });

  it('create_lead: 401 when unauthenticated (truth boundary)', async () => {
    getSession.mockResolvedValueOnce(null);
    const res = await leads.POST(jsonReq('http://t/api/leads', { name: 'Acme', type: 'seller' }));
    expect(res.status).toBe(401);
  });

  it('create_campaign: 200 draft', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 1, name: 'Q1', status: 'draft' }]);
    const res = await campaigns.POST(
      jsonReq('http://t/api/campaigns', { name: 'Q1', message_template: 'hi' })
    );
    expect(res.status).toBe(200);
  });

  it('launch_campaign: enqueues an idempotent send job per pending member', async () => {
    // campaign lookup, then members, then per-member conv upsert/append
    sqlMock
      .mockResolvedValueOnce([
        { id: 1, message_template: 'hi', daily_cap: 100, throttle_per_minute: 10 },
      ])
      .mockResolvedValueOnce([{ campaign_lead_id: 5, lead_id: 9, phone: '+15555550100' }])
      .mockResolvedValue([{ id: 1 }]);
    const res = await launch.POST(jsonReq('http://t/api/campaigns/1/launch', {}), {
      params: Promise.resolve({ id: '1' }),
    } as any);
    expect(res.status).toBe(200);
    expect(enqueueJob).toHaveBeenCalledTimes(1);
    const opts = enqueueJob.mock.calls[0][2];
    expect(opts.dedupeKey).toBe('send:1:9');
    expect(opts.runAt).toBeInstanceOf(Date);
  });

  it('process_jobs: 401 without the runner secret', async () => {
    const res = await jobsProcess.POST(jsonReq('http://t/api/jobs/process', {}));
    expect(res.status).toBe(401);
  });

  it('inbound_reply: 401 without sms secret; 200 with it', async () => {
    const bad = await inbound.POST(jsonReq('http://t/api/sms/inbound', { from: 'x', text: 'y' }));
    expect(bad.status).toBe(401);

    sqlMock
      .mockResolvedValueOnce([{ id: 9, phone: '+15555550100' }]) // lead lookup
      .mockResolvedValueOnce([{ id: 3 }]) // conv upsert
      .mockResolvedValue([]); // append
    const ok = await inbound.POST(
      jsonReq(
        'http://t/api/sms/inbound',
        { from: '+15555550100', text: 'Yes' },
        { 'x-sms-secret': 'test-sms' }
      )
    );
    expect(ok.status).toBe(200);
  });
});

// ---- Layer B: csv_import_10k behavior (pure + handler) ----
describe('LAYER B — csv_import_10k behavior', () => {
  it('parse_stream + dedupe + chunk produce expected shapes', () => {
    const csv = ['name,phone', 'A,+15555550100', 'A dup,(555) 555-0100', 'B,+15555550101'].join(
      '\n'
    );
    const { valid } = parseLeadsCsv(csv);
    const { unique, duplicates } = dedupeInBatch(valid);
    expect(unique).toHaveLength(2);
    expect(duplicates).toHaveLength(1);
    expect(chunk(unique, 1)).toHaveLength(2);
  });

  it('bulk_insert: 200 with import summary', async () => {
    sqlMock
      .mockResolvedValueOnce([]) // existing dedupe_hash lookup
      .mockResolvedValueOnce([{ id: 1 }]) // imports insert
      .mockResolvedValueOnce([{ id: 10 }, { id: 11 }]) // batch insert returning
      .mockResolvedValue([]); // finalize update
    const csv = 'name,phone\nA,+15555550100\nB,+15555550101';
    const res = await bulk.POST(jsonReq('http://t/api/leads/bulk', { text: csv, source: 'paste' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.importId).toBe(1);
  });

  it('bulk_insert: 413 when over the 10k cap', async () => {
    const rows = ['name,phone'];
    for (let i = 0; i < 10001; i++) rows.push(`L${i},+1555${String(i).padStart(7, '0')}`);
    const res = await bulk.POST(
      jsonReq('http://t/api/leads/bulk', { text: rows.join('\n'), source: 'paste' })
    );
    expect(res.status).toBe(413);
  });
});



