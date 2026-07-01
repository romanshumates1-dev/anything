import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recordMetric, getMetrics, clearMetrics } from '@/app/api/utils/observability';

describe('observability', () => {
  beforeEach(() => { clearMetrics(); });

  it('records and retrieves metrics', () => {
    recordMetric({ name: 'sms_sent', value: 1, ts: Date.now(), tags: { campaign: 'q1' } });
    const m = getMetrics();
    expect(m).toHaveLength(1);
    expect(m[0].name).toBe('sms_sent');
  });
});