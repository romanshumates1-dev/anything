/**
 * Tests for Pipeline Health Engine
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getNextCheckIntervalMs,
  HEALTH_CHECK_INTERVALS_HOURS,
} from '../pipeline-health-engine';

describe('Pipeline Health Engine', () => {
  describe('exponential backoff intervals', () => {
    it('returns 1 hour for 0 consecutive failures', () => {
      expect(getNextCheckIntervalMs(0)).toBe(1 * 60 * 60 * 1000);
    });

    it('returns 2 hours for 1 consecutive failure', () => {
      expect(getNextCheckIntervalMs(1)).toBe(2 * 60 * 60 * 1000);
    });

    it('returns 4 hours for 2 consecutive failures', () => {
      expect(getNextCheckIntervalMs(2)).toBe(4 * 60 * 60 * 1000);
    });

    it('returns 8 hours for 3+ consecutive failures', () => {
      expect(getNextCheckIntervalMs(3)).toBe(8 * 60 * 60 * 1000);
      expect(getNextCheckIntervalMs(4)).toBe(8 * 60 * 60 * 1000);
      expect(getNextCheckIntervalMs(10)).toBe(8 * 60 * 60 * 1000);
    });

    it('has correct interval sequence', () => {
      expect(HEALTH_CHECK_INTERVALS_HOURS).toEqual([1, 2, 4, 8]);
    });
  });

  describe('health check intervals are reasonable', () => {
    it('minimum interval is 1 hour', () => {
      const minMs = Math.min(...HEALTH_CHECK_INTERVALS_HOURS) * 60 * 60 * 1000;
      expect(minMs).toBe(3_600_000); // 1 hour
    });

    it('maximum interval is 8 hours', () => {
      const maxMs = Math.max(...HEALTH_CHECK_INTERVALS_HOURS) * 60 * 60 * 1000;
      expect(maxMs).toBe(28_800_000); // 8 hours
    });
  });
});

describe('Health check configuration', () => {
  it('intervals double each step (exponential backoff)', () => {
    for (let i = 1; i < HEALTH_CHECK_INTERVALS_HOURS.length; i++) {
      expect(HEALTH_CHECK_INTERVALS_HOURS[i]).toBe(HEALTH_CHECK_INTERVALS_HOURS[i - 1] * 2);
    }
  });
});
