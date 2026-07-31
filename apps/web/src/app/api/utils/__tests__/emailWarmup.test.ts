import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn() }));
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

import { canSendEmail, recordEmailSend, recordEmailBounce, checkAutoPause, getCurrentDailyLimit } from '../emailWarmup';

beforeEach(() => {
  mockSql.mockReset();
});

describe('canSendEmail', () => {
  it('blocks when paused', async () => {
    mockSql.mockResolvedValueOnce([{
      daily_limit: 20, ramp_increment: 10, ramp_interval_days: 2,
      auto_pause_bounce_pct: '5.0', auto_pause_complaint_pct: '0.1',
      paused: true, paused_reason: 'Bounce rate too high',
    }]);
    const result = await canSendEmail('org_1');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('paused');
  });

  it('allows when under daily limit', async () => {
    mockSql.mockResolvedValueOnce([]);  // getWarmupConfig in canSendEmail
    mockSql.mockResolvedValueOnce([]);  // getWarmupConfig in getCurrentDailyLimit
    mockSql.mockResolvedValueOnce([{ days_active: '3' }]);
    mockSql.mockResolvedValueOnce([{ sent_count: 5 }]);
    const result = await canSendEmail('org_1');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeGreaterThan(0);
  });

  it('blocks when daily limit reached', async () => {
    mockSql.mockResolvedValueOnce([]);  // getWarmupConfig in canSendEmail
    mockSql.mockResolvedValueOnce([]);  // getWarmupConfig in getCurrentDailyLimit
    mockSql.mockResolvedValueOnce([{ days_active: '0' }]);
    mockSql.mockResolvedValueOnce([{ sent_count: 20 }]);
    const result = await canSendEmail('org_1');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.reason).toContain('limit');
  });
});

describe('getCurrentDailyLimit', () => {
  it('returns base limit on day 0', async () => {
    mockSql.mockResolvedValueOnce([]);
    mockSql.mockResolvedValueOnce([{ days_active: '0' }]);
    const limit = await getCurrentDailyLimit('org_1');
    expect(limit).toBe(20);
  });

  it('ramps up after interval days', async () => {
    mockSql.mockResolvedValueOnce([]);
    mockSql.mockResolvedValueOnce([{ days_active: '6' }]);
    const limit = await getCurrentDailyLimit('org_1');
    expect(limit).toBe(50);
  });

  it('returns 0 when paused', async () => {
    mockSql.mockResolvedValueOnce([{
      daily_limit: 20, ramp_increment: 10, ramp_interval_days: 2,
      auto_pause_bounce_pct: '5.0', auto_pause_complaint_pct: '0.1',
      paused: true, paused_reason: 'test',
    }]);
    const limit = await getCurrentDailyLimit('org_1');
    expect(limit).toBe(0);
  });
});

describe('recordEmailSend', () => {
  it('upserts into email_daily_sends', async () => {
    mockSql.mockResolvedValueOnce([]);
    await recordEmailSend('org_1');
    expect(mockSql).toHaveBeenCalledTimes(1);
    const call = mockSql.mock.calls[0];
    const queryStr = call[0].reduce((acc: string, s: string, i: number) => acc + s + (call[i + 1] !== undefined ? `$${i + 1}` : ''), '');
    expect(queryStr).toContain('email_daily_sends');
    expect(queryStr).toContain('ON CONFLICT');
  });
});

describe('checkAutoPause', () => {
  it('pauses when bounce rate exceeds threshold', async () => {
    mockSql.mockResolvedValueOnce([]);
    mockSql.mockResolvedValueOnce([{ sent_count: 100, bounce_count: 6, complaint_count: 0 }]);
    mockSql.mockResolvedValueOnce([]);
    const paused = await checkAutoPause('org_1');
    expect(paused).toBe(true);
    expect(mockSql).toHaveBeenCalledTimes(3);
  });

  it('pauses when complaint rate exceeds threshold', async () => {
    mockSql.mockResolvedValueOnce([]);
    mockSql.mockResolvedValueOnce([{ sent_count: 1000, bounce_count: 0, complaint_count: 2 }]);
    mockSql.mockResolvedValueOnce([]);
    const paused = await checkAutoPause('org_1');
    expect(paused).toBe(true);
  });

  it('does not pause when rates are healthy', async () => {
    mockSql.mockResolvedValueOnce([]);
    mockSql.mockResolvedValueOnce([{ sent_count: 100, bounce_count: 2, complaint_count: 0 }]);
    const paused = await checkAutoPause('org_1');
    expect(paused).toBe(false);
  });

  it('does not pause when already paused', async () => {
    mockSql.mockResolvedValueOnce([{
      daily_limit: 20, ramp_increment: 10, ramp_interval_days: 2,
      auto_pause_bounce_pct: '5.0', auto_pause_complaint_pct: '0.1',
      paused: true, paused_reason: 'already',
    }]);
    const paused = await checkAutoPause('org_1');
    expect(paused).toBe(true);
    expect(mockSql).toHaveBeenCalledTimes(1);
  });
});
