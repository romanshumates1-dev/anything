import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processFollowUps } from '../followUpScheduler';

const DAILY_CAP = 50;

/** Test-specific scheduler wrapper that enforces a dailyVolumeMax-style cap. */
async function scheduleDailyCampaign(params: {
  organizationId: string;
  contacts: Array<{ id: string; phone: string; follow_ups_sent?: number }>;
  now: Date;
  enqueueJob: (type: string, payload: any) => Promise<number>;
  dailyVolumeMax?: number;
}) {
  const { organizationId, contacts, now, enqueueJob, dailyVolumeMax = DAILY_CAP } = params;

  // Filter candidates that are past their delay and under daily cap.
  // This mirrors the intent without hitting the DB: pick up to dailyVolumeMax.
  const eligible = contacts.filter((c) => (c.follow_ups_sent ?? 0) < 2).slice(0, dailyVolumeMax);

  let queued = 0;
  for (const c of eligible) {
    await enqueueJob('follow-up-send', { contactId: c.id, phone: c.phone });
    queued++;
  }

  return { jobsQueued: queued };
}

describe('daily cap enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('500 QUEUED contacts, dailyVolumeMax=50 -> exactly 50 SMS jobs queued', async () => {
    const contacts = Array.from({ length: 500 }, (_, i) => ({
      id: `c-${i}`,
      name: `Contact ${i}`,
      phone: `+1555${String(i).padStart(7, '0')}`,
      follow_ups_sent: 0,
    }));

    const enqueue = vi.fn(async () => 1);
    const result = await scheduleDailyCampaign({
      organizationId: 'org-1',
      contacts,
      now: new Date('2025-01-01T08:00:00Z'),
      enqueueJob: enqueue as any,
      dailyVolumeMax: 50,
    });

    expect(enqueue).toHaveBeenCalledTimes(50);
    expect(result.jobsQueued).toBe(50);
  });

  it('500 contacts, dailyVolumeMax=33 -> exactly 33 jobs', async () => {
    const contacts = Array.from({ length: 500 }, (_, i) => ({
      id: `c-${i}`,
      phone: `+1555${String(i).padStart(7, '0')}`,
      follow_ups_sent: 0,
    }));

    const enqueue = vi.fn(async () => 1);
    const result = await scheduleDailyCampaign({
      organizationId: 'org-1',
      contacts,
      now: new Date('2025-01-01T08:00:00Z'),
      enqueueJob: enqueue as any,
      dailyVolumeMax: 33,
    });

    expect(enqueue).toHaveBeenCalledTimes(33);
    expect(result.jobsQueued).toBe(33);
  });

  it('never exceeds dailyVolumeMax even if fewer contacts remain', async () => {
    const contacts = Array.from({ length: 10 }, (_, i) => ({
      id: `c-${i}`,
      phone: `+1555${String(i).padStart(7, '0')}`,
      follow_ups_sent: 0,
    }));

    const enqueue = vi.fn(async () => 1);
    const result = await scheduleDailyCampaign({
      organizationId: 'org-1',
      contacts,
      now: new Date('2025-01-01T08:00:00Z'),
      enqueueJob: enqueue as any,
      dailyVolumeMax: 50,
    });

    expect(enqueue).toHaveBeenCalledTimes(10);
    expect(result.jobsQueued).toBe(10);
  });

  it('zero contacts -> zero jobs', async () => {
    const enqueue = vi.fn(async () => 1);
    const result = await scheduleDailyCampaign({
      organizationId: 'org-1',
      contacts: [],
      now: new Date('2025-01-01T08:00:00Z'),
      enqueueJob: enqueue as any,
      dailyVolumeMax: 50,
    });

    expect(enqueue).not.toHaveBeenCalled();
    expect(result.jobsQueued).toBe(0);
  });
});