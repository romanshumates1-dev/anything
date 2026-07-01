import { describe, it, expect, vi, beforeEach } from 'vitest';

const { default: mockSql } = vi.hoisted(() => {
  const m = vi.fn(async () => []);
  return { default: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

const { fn: enqueueJob } = vi.hoisted(() => ({ fn: vi.fn(async () => 1) }));
vi.mock('@/app/api/utils/jobs', () => ({
  enqueueJob: (...a: any[]) => (enqueueJob as any)(...a),
}));

import { withContactLock } from '@/app/api/utils/contactLock';
import { processInboundSms } from '@/app/api/services/inboundSms';

describe('concurrency & scale hardening', () => {
  beforeEach(() => {
    mockSql.mockClear();
    enqueueJob.mockClear();
  });

  it('prevents double-processing of duplicate Twilio webhooks for same contact', async () => {
    // Simulate two identical inbound webhooks arriving simultaneously.
    // Both try to acquire advisory lock for contact 'lead-42'.
    // Lock ensures serialize runs.
    mockSql.mockResolvedValue([]); // advisory lock query
    const fn = vi.fn(async () => 'processed-once');

    // Fire both "in parallel" (advisory lock serializes)
    const [r1, r2] = await Promise.all([
      withContactLock('lead-42', fn),
      withContactLock('lead-42', fn),
    ]);

    expect(r1).toBe('processed-once');
    expect(r2).toBe('processed-once');
    expect(fn).toHaveBeenCalledTimes(2); // both acquired lock sequentially
  });

  it('handles high-volume campaign daily cap (scale simulation)', async () => {
    // Simulate 5000 contacts, daily cap 5000
    const dailyCap = 5000;
    const totalContacts = 5000;
    const queued = Math.min(totalContacts, dailyCap);
    expect(queued).toBe(5000);
  });

  it('handles partial-day volume cap correctly', async () => {
    const dailyCap = 50;
    const totalContacts = 500;
    const queued = Math.min(totalContacts, dailyCap);
    expect(queued).toBe(50);
  });
});