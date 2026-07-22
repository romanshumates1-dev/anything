/**
 * Wiring recordStageTransition into the outreach inbound-reply simulator
 * (BREAKAGE_TABLE.md session (s): funnel analytics was permanently empty —
 * nothing ever wrote to stage_transitions). This is the ONLY place in the
 * codebase that ever sets campaign_contacts.status = 'ENGAGED' — an
 * affirmative reply is the real "engaged" event.
 *
 * Mutation-proven RED: with the recordStageTransition call removed from the
 * route (the original, unfixed code), this test fails because the mock is
 * never invoked. Restoring the call makes it pass.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql } = vi.hoisted(() => {
  const m: any = vi.fn(async () => []);
  m.transaction = vi.fn(async () => []);
  m.query = m;
  return { mockSql: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: (...a: any[]) => getSession(...a) } } }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));

const { getOrganization } = vi.hoisted(() => ({ getOrganization: vi.fn() }));
vi.mock('@/lib/organization-context', () => ({ getOrganization: (...a: any[]) => getOrganization(...a) }));

vi.mock('@/app/api/utils/logger', () => ({ logEvent: vi.fn(async () => {}) }));

const { processInboundSms } = vi.hoisted(() => ({ processInboundSms: vi.fn() }));
vi.mock('@/app/api/services/inboundSms', () => ({ processInboundSms }));

const { withContactLock } = vi.hoisted(() => ({
  withContactLock: vi.fn(async (_id: string, fn: () => Promise<any>) => fn()),
}));
vi.mock('@/app/api/utils/contactLock', () => ({ withContactLock }));

const { recordStageTransition, resolveLeadIdByPhone } = vi.hoisted(() => ({
  recordStageTransition: vi.fn(async () => {}),
  resolveLeadIdByPhone: vi.fn(async () => null as number | null),
}));
vi.mock('@/app/api/services/stageTransitionRecorder', () => ({ recordStageTransition, resolveLeadIdByPhone }));

import { POST } from './route';

const req = (body: unknown) =>
  new Request('http://t/api/outreach/inbound', { method: 'POST', body: JSON.stringify(body) }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: 'user-1' } });
  getOrganization.mockResolvedValue({ id: 'org-1' });
});

describe('POST /api/outreach/inbound', () => {
  it('records an ENGAGED stage transition on an affirmative reply', async () => {
    processInboundSms.mockResolvedValueOnce({
      action: 'contact_reply',
      contactId: 'cc-1',
      campaignId: 'camp-1',
      direction: 'SELLER',
      body: 'yes',
    });
    resolveLeadIdByPhone.mockResolvedValueOnce(88);
    mockSql.mockResolvedValueOnce([]); // UPDATE campaign_contacts -> ENGAGED

    const res = await POST(req({ from: '+15025551234', to: '+15025559999', message: 'yes' }));
    expect(res.status).toBe(200);

    expect(resolveLeadIdByPhone).toHaveBeenCalledWith('+15025551234');
    expect(recordStageTransition).toHaveBeenCalledTimes(1);
    expect(recordStageTransition).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: 88, fromStage: 'CONTACTED', toStage: 'ENGAGED', campaignId: 'camp-1', channel: 'inbound' })
    );
  });

  it('does not record a transition on a non-affirmative reply', async () => {
    processInboundSms.mockResolvedValueOnce({
      action: 'contact_reply',
      contactId: 'cc-1',
      campaignId: 'camp-1',
      direction: 'SELLER',
      body: 'maybe later',
    });

    const res = await POST(req({ from: '+15025551234', to: '+15025559999', message: 'maybe later' }));
    expect(res.status).toBe(200);
    expect(recordStageTransition).not.toHaveBeenCalled();
  });

  it('does not record a transition when no lead matches the phone (best-effort)', async () => {
    processInboundSms.mockResolvedValueOnce({
      action: 'contact_reply',
      contactId: 'cc-1',
      campaignId: 'camp-1',
      direction: 'SELLER',
      body: 'yes',
    });
    resolveLeadIdByPhone.mockResolvedValueOnce(null);
    mockSql.mockResolvedValueOnce([]);

    const res = await POST(req({ from: '+15025551234', to: '+15025559999', message: 'yes' }));
    expect(res.status).toBe(200);
    expect(recordStageTransition).not.toHaveBeenCalled();
  });

  it('does not record a transition for a non-reply action (e.g. opted_out)', async () => {
    processInboundSms.mockResolvedValueOnce({ action: 'opted_out', contactId: 'cc-1' });

    const res = await POST(req({ from: '+15025551234', to: '+15025559999', message: 'STOP' }));
    expect(res.status).toBe(200);
    expect(recordStageTransition).not.toHaveBeenCalled();
  });
});
