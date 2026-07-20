/**
 * meterSmsSend (Gap G-5) — per-send metering.
 *
 * Proves the worker path meters the REAL segment count into usage + spend, and
 * that an empty body is a no-op (never writes).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql } = vi.hoisted(() => {
  const m: any = vi.fn(async () => []);
  return { mockSql: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: vi.fn() } } }));

import { meterSmsSend } from './entitlement';

beforeEach(() => {
  mockSql.mockClear();
  mockSql.mockResolvedValue([]);
});

describe('meterSmsSend', () => {
  it('meters segments + spend for a real message (getSubscription, consumeUsage, recordTwilioSpend)', async () => {
    mockSql
      .mockResolvedValueOnce([]) // getSubscription → none (null → current period)
      .mockResolvedValueOnce([{ count: 1 }]) // consumeUsage upsert
      .mockResolvedValueOnce([]); // recordTwilioSpend insert
    const res = await meterSmsSend('user-1', 'hello world', { messageSid: 'SM1' });
    expect(res.segments).toBe(1);
    expect(res.costCents).toBeGreaterThan(0);
    expect(mockSql).toHaveBeenCalledTimes(3);
  });

  it('counts multi-segment bodies', async () => {
    mockSql.mockResolvedValue([]);
    const res = await meterSmsSend('user-1', 'a'.repeat(161));
    expect(res.segments).toBe(2);
  });

  it('is a no-op for an empty body (no DB writes)', async () => {
    const res = await meterSmsSend('user-1', '');
    expect(res).toEqual({ segments: 0, costCents: 0 });
    expect(mockSql).not.toHaveBeenCalled();
  });
});
