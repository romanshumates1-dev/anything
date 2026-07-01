import { describe, it, expect, vi, beforeEach } from 'vitest';

const { default: mockSql } = vi.hoisted(() => {
  const m = vi.fn(async () => []) as any;
  const t = vi.fn(async (queries: any[]) => queries.map((q: any) => q));
  (m as any).transaction = t;
  return { default: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

const { fn: logEvent } = vi.hoisted(() => ({ fn: vi.fn(async () => {}) }));
vi.mock('@/app/api/utils/logger', () => ({ logEvent, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { checkConsent, registerOptOut, registerConsent } from '@/app/api/utils/compliance';

describe('compliance', () => {
  beforeEach(() => {
    mockSql.mockClear();
    logEvent.mockClear();
  });

  it('allows send when no opt-out record exists', async () => {
    mockSql.mockResolvedValueOnce([]); // no opt-out row
    const ok = await checkConsent('+15555550100', 'sms');
    expect(ok).toBe(true);
  });

  it('blocks send after opt-out is registered', async () => {
    mockSql.mockResolvedValueOnce([{ id: 1 }]); // opt-out row present
    const ok = await checkConsent('+15555550100', 'sms');
    expect(ok).toBe(false);
  });

  it('registers opt-out and logs event', async () => {
    mockSql.mockResolvedValueOnce(undefined);
    await registerOptOut('+15555550100', 'sms', { source: 'STOP' });
    expect(logEvent).toHaveBeenCalledWith('compliance_opt_out', 'compliance', '+15555550100', { channel: 'sms', source: 'STOP' });
  });

  it('re-consent clears opt-out and allows send again', async () => {
    mockSql.mockResolvedValueOnce(undefined); // DELETE
    mockSql.mockResolvedValueOnce(undefined); // INSERT
    await registerConsent('+15555550100', 'sms', { source: 'YES' });
    expect(logEvent).toHaveBeenCalledWith('compliance_consent', 'compliance', '+15555550100', { channel: 'sms', source: 'YES' });
  });
});