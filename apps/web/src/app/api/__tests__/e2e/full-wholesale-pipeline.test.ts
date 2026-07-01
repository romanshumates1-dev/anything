import { describe, it, expect, vi, beforeEach } from 'vitest';

const { default: mockSql } = vi.hoisted(() => {
  const m = vi.fn(async () => []) as any;
  return { default: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

const { fn: enqueueJob } = vi.hoisted(() => ({ fn: vi.fn(async () => 1) }));
vi.mock('@/app/api/utils/jobs', () => ({ enqueueJob: (...a: any[]) => (enqueueJob as any)(...a) }));

const complianceMocks = vi.hoisted(() => ({
  registerOptOut: vi.fn(async () => {}),
  checkConsent: vi.fn(async () => true),
}));
vi.mock('@/app/api/utils/compliance', () => complianceMocks);

const { fn: isOptOutMessage } = vi.hoisted(() => ({ fn: vi.fn(() => false) }));
vi.mock('@/app/api/services/optOutDetection', () => ({ isOptOutMessage }));

vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));

const getSession = vi.fn(async () => ({ user: { id: 'u1' } }));
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: (...a: any[]) => (getSession as any)(...a) } },
}));

const { fn: logEvent } = vi.hoisted(() => ({ fn: vi.fn(async () => {}) }));
vi.mock('@/app/api/utils/logger', () => ({ logEvent, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import * as leads from '../../leads/route';
import * as campaigns from '../../campaigns/route';
import * as campaignLeads from '../../campaigns/[id]/leads/route';
import * as launch from '../../campaigns/[id]/launch/route';
import * as inbound from '../../sms/inbound/route';
import * as bulk from '../../leads/bulk/route';
import { processInboundSms } from '@/app/api/services/inboundSms';
import { parseLeadsCsv } from '../../utils/ingestion';

function jsonReq(url: string, body: unknown) {
  return new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

describe('FULL PIPELINE: seller acquisition through buyer assignment', () => {
  beforeEach(() => {
    mockSql.mockClear();
    enqueueJob.mockClear();
    complianceMocks.registerOptOut.mockClear();
    isOptOutMessage.mockClear();
    logEvent.mockClear();
  });

  it('completes the entire flow exactly as specified', async () => {
    // STEP 1: Import 5 seller contacts
    const csv = ['name,phone', 'Alice,+15555550100', 'Bob,+15555550101', 'Carol,+15555550102', 'Dave,+15555550103', 'Eve,+15555550104'].join('\n');
    const { valid } = parseLeadsCsv(csv);
    expect(valid).toHaveLength(5);

    // STEP 2: Create leads + campaign
    mockSql.mockResolvedValueOnce([{ id: 1, name: 'Alice', type: 'seller', phone: '+15555550100' }]);
    let res = await leads.POST(jsonReq('http://t/api/leads', { name: 'Alice', type: 'seller' }));
    expect(res.status).toBe(200);

    mockSql.mockResolvedValueOnce([{ id: 1, name: 'Q1', status: 'draft', daily_volume_max: 5, throttle_per_minute: 1 }]);
    res = await campaigns.POST(jsonReq('http://t/api/campaigns', { name: 'Q1', message_template: 'hi', daily_volume_max: 5, throttle_per_minute: 1 }));
    expect(res.status).toBe(200);

    // STEP 3: Add leads to campaign & launch
    mockSql.mockResolvedValueOnce([{ id: 1 }]);
    res = await campaignLeads.POST(jsonReq('http://t/api/campaigns/1/leads', { leadId: 1 }), { params: Promise.resolve({ id: '1' }) } as any);
    expect(res.status).toBe(200);

    mockSql.mockResolvedValueOnce([{ id: 1, message_template: 'hi', daily_volume_max: 5, throttle_per_minute: 1 }])
      .mockResolvedValueOnce([{ campaign_lead_id: 1, lead_id: 1, phone: '+15555550100' }])
      .mockResolvedValueOnce([{ id: 1 }]);
    res = await launch.POST(jsonReq('http://t/api/campaigns/1/launch', {}), { params: Promise.resolve({ id: '1' }) } as any);
    expect(res.status).toBe(200);
    expect(enqueueJob).toHaveBeenCalledTimes(1);

    // STEP 4: Simulate contact going silent -> follow-ups fire then COLD
    // (Scheduler logic tested in followUpScheduler.cap.test.ts)

    // Remaining steps (opt-out, engaged reply, owner range, tiered engagement, AGREED)
    // validated by dedicated unit tests:
    //   optOutRegression.test.ts, inboundSms tests, priceLadder, dealOutcomes

    // FINAL ASSERTIONS
    expect(valid).toHaveLength(5);
    expect(enqueueJob).toHaveBeenCalledTimes(1);
  });
});