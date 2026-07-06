import { describe, it, expect } from 'vitest';
import {
  computeDailyCapacity,
  requiredNumbersForVolume,
  canFitDailyVolume,
  DEFAULT_THROUGHPUT,
  computeThroughputCeiling,
  getTrustLevelFromNumberType,
  type TrustLevel,
  type ThroughputConfig,
} from '../numberPool';

describe('numberPool — 10DLC A2P throughput model', () => {
  const TCPA_WINDOW_HOURS = 13; // 8am-9pm recipient local

  describe('DEFAULT_THROUGHPUT scenarios', () => {
    it('defines three trust levels with realistic carrier constraints', () => {
      expect(DEFAULT_THROUGHPUT).toHaveProperty('low');
      expect(DEFAULT_THROUGHPUT).toHaveProperty('medium');
      expect(DEFAULT_THROUGHPUT).toHaveProperty('high');
    });

    it('low trust: ~2000/day cap (T-Mobile sole-proprietor limit)', () => {
      const low = DEFAULT_THROUGHPUT.low;
      expect(low.tMobileDailyCap).toBe(2000);
      expect(low.mps).toBe(1);
      expect(low.trustLevel).toBe('low');
    });

    it('medium trust: ~10000/day cap (vetted brand)', () => {
      const medium = DEFAULT_THROUGHPUT.medium;
      expect(medium.tMobileDailyCap).toBe(10000);
      expect(medium.mps).toBe(10);
      expect(medium.trustLevel).toBe('medium');
    });

    it('high trust: ~50000/day cap (enterprise/pre-vetted)', () => {
      const high = DEFAULT_THROUGHPUT.high;
      expect(high.tMobileDailyCap).toBe(50000);
      expect(high.mps).toBe(50);
      expect(high.trustLevel).toBe('high');
    });
  });

  describe('computeDailyCapacity — min(MPS × windowSec, tMobileDailyCap)', () => {
    it('returns T-Mobile cap when MPS × windowSec exceeds it', () => {
      const config = DEFAULT_THROUGHPUT.low;
      const capacity = computeDailyCapacity(config, TCPA_WINDOW_HOURS);
      // MPS=1 × 46800sec = 46800, but T-Mobile cap=2000 → result=2000
      expect(capacity).toBe(2000);
    });

    it('respects MPS limit when it is the bottleneck', () => {
      // Contrived example: MPS=1, windowHours=1 → 3600 < 2000 T-Mobile cap
      const config: ThroughputConfig = {
        mps: 1,
        tMobileDailyCap: 10000,
        trustLevel: 'medium',
      };
      const capacity = computeDailyCapacity(config, 1);
      expect(capacity).toBe(3600);
    });

    it('scales correctly with high-trust MPS', () => {
      const config = DEFAULT_THROUGHPUT.high;
      const capacity = computeDailyCapacity(config, TCPA_WINDOW_HOURS);
      // MPS=50 × 46800sec = 2,340,000, but T-Mobile cap=50000 → result=50000
      expect(capacity).toBe(50000);
    });

    it('handles fractional hours (e.g., 2.5-hour send window)', () => {
      const config = DEFAULT_THROUGHPUT.medium;
      const capacity = computeDailyCapacity(config, 2.5);
      // MPS=10 × 9000sec = 90000, but T-Mobile cap=10000 → result=10000
      expect(capacity).toBe(10000);
    });
  });

  describe('Volume feasibility — canFitDailyVolume', () => {
    describe('10DLC number type', () => {
      it('accepts 50 msgs/day at any trust level', () => {
        expect(canFitDailyVolume(50, TCPA_WINDOW_HOURS, '10dlc', 'low')).toBe(true);
        expect(canFitDailyVolume(50, TCPA_WINDOW_HOURS, '10dlc', 'medium')).toBe(true);
        expect(canFitDailyVolume(50, TCPA_WINDOW_HOURS, '10dlc', 'high')).toBe(true);
      });

      it('accepts 100 msgs/day at any trust level', () => {
        expect(canFitDailyVolume(100, TCPA_WINDOW_HOURS, '10dlc', 'low')).toBe(true);
        expect(canFitDailyVolume(100, TCPA_WINDOW_HOURS, '10dlc', 'medium')).toBe(true);
        expect(canFitDailyVolume(100, TCPA_WINDOW_HOURS, '10dlc', 'high')).toBe(true);
      });

      it('accepts 1000 msgs/day at any trust level', () => {
        expect(canFitDailyVolume(1000, TCPA_WINDOW_HOURS, '10dlc', 'low')).toBe(true);
        expect(canFitDailyVolume(1000, TCPA_WINDOW_HOURS, '10dlc', 'medium')).toBe(true);
        expect(canFitDailyVolume(1000, TCPA_WINDOW_HOURS, '10dlc', 'high')).toBe(true);
      });

      it('rejects 5000 msgs/day at low trust (needs multiple numbers)', () => {
        expect(canFitDailyVolume(5000, TCPA_WINDOW_HOURS, '10dlc', 'low')).toBe(false);
      });

      it('accepts 5000 msgs/day at medium trust', () => {
        expect(canFitDailyVolume(5000, TCPA_WINDOW_HOURS, '10dlc', 'medium')).toBe(true);
      });

      it('accepts 5000 msgs/day at high trust', () => {
        expect(canFitDailyVolume(5000, TCPA_WINDOW_HOURS, '10dlc', 'high')).toBe(true);
      });

      it('rejects volumes exceeding high trust capacity', () => {
        expect(canFitDailyVolume(60000, TCPA_WINDOW_HOURS, '10dlc', 'high')).toBe(false);
      });
    });

    describe('toll-free number type', () => {
      it('has independent 10 MPS throughput ceiling', () => {
        const ceiling = computeThroughputCeiling('toll-free');
        expect(ceiling).toBe(10);
      });

      it('accepts volumes up to ~468000 per day (13h window)', () => {
        expect(canFitDailyVolume(468000, TCPA_WINDOW_HOURS, 'toll-free')).toBe(true);
      });

      it('rejects volumes exceeding toll-free capacity', () => {
        expect(canFitDailyVolume(500000, TCPA_WINDOW_HOURS, 'toll-free')).toBe(false);
      });
    });

    describe('short-code number type', () => {
      it('has independent 100 MPS throughput ceiling', () => {
        const ceiling = computeThroughputCeiling('short-code');
        expect(ceiling).toBe(100);
      });

      it('accepts large volumes (100 MPS × 46800 = 4.68M)', () => {
        expect(canFitDailyVolume(4680000, TCPA_WINDOW_HOURS, 'short-code')).toBe(true);
      });
    });
  });

  describe('requiredNumbersForVolume — how many numbers needed', () => {
    describe('10DLC', () => {
      it('requires 1 number for 50/day at low trust', () => {
        expect(requiredNumbersForVolume(50, TCPA_WINDOW_HOURS, '10dlc', 'low')).toBe(1);
      });

      it('requires 1 number for 1000/day at low trust', () => {
        expect(requiredNumbersForVolume(1000, TCPA_WINDOW_HOURS, '10dlc', 'low')).toBe(1);
      });

      it('requires 3 numbers for 5000/day at low trust (2000 cap per number)', () => {
        const needed = requiredNumbersForVolume(5000, TCPA_WINDOW_HOURS, '10dlc', 'low');
        expect(needed).toBe(3); // ceil(5000/2000) = 3
      });

      it('requires 1 number for 5000/day at medium trust', () => {
        expect(requiredNumbersForVolume(5000, TCPA_WINDOW_HOURS, '10dlc', 'medium')).toBe(1);
      });

      it('requires 2 numbers for 50000/day at medium trust (10000 cap per number)', () => {
        const needed = requiredNumbersForVolume(50000, TCPA_WINDOW_HOURS, '10dlc', 'medium');
        expect(needed).toBe(5); // ceil(50000/10000) = 5
      });

      it('defaults to medium trust when not specified', () => {
        const withoutTrust = requiredNumbersForVolume(5000, TCPA_WINDOW_HOURS, '10dlc');
        const withMedium = requiredNumbersForVolume(5000, TCPA_WINDOW_HOURS, '10dlc', 'medium');
        expect(withoutTrust).toBe(withMedium);
        expect(withoutTrust).toBe(1);
      });
    });

    describe('toll-free', () => {
      it('requires 1 number for 100000/day (10 MPS capacity)', () => {
        // 10 MPS × 46800 = 468000 capacity per number
        expect(requiredNumbersForVolume(100000, TCPA_WINDOW_HOURS, 'toll-free')).toBe(1);
      });

      it('requires 2 numbers for 500000/day', () => {
        const needed = requiredNumbersForVolume(500000, TCPA_WINDOW_HOURS, 'toll-free');
        expect(needed).toBeGreaterThanOrEqual(2);
      });
    });
  });

  describe('computeThroughputCeiling — base MPS by number type', () => {
    it('10dlc: 1 MPS (overridden by trust level config)', () => {
      expect(computeThroughputCeiling('10dlc')).toBe(1);
    });

    it('toll-free: 10 MPS', () => {
      expect(computeThroughputCeiling('toll-free')).toBe(10);
    });

    it('short-code: 100 MPS', () => {
      expect(computeThroughputCeiling('short-code')).toBe(100);
    });

    it('unknown type: defaults to 1 MPS', () => {
      expect(computeThroughputCeiling('unknown' as any)).toBe(1);
    });
  });

  describe('getTrustLevelFromNumberType', () => {
    it('10dlc → medium trust', () => {
      expect(getTrustLevelFromNumberType('10dlc')).toBe('medium');
    });

    it('toll-free → medium trust', () => {
      expect(getTrustLevelFromNumberType('toll-free')).toBe('medium');
    });

    it('short-code → high trust', () => {
      expect(getTrustLevelFromNumberType('short-code')).toBe('high');
    });
  });

  describe('Volume planning table — 3 trust scenarios', () => {
    const volumes = [50, 100, 1000, 5000];

    it('low trust: shows where 5000/day exceeds capacity', () => {
      const lowConfig = DEFAULT_THROUGHPUT.low;
      const capacity = computeDailyCapacity(lowConfig, TCPA_WINDOW_HOURS);
      expect(capacity).toBe(2000);

      const volume5k = volumes.find((v) => v === 5000);
      if (volume5k) {
        expect(canFitDailyVolume(volume5k, TCPA_WINDOW_HOURS, '10dlc', 'low')).toBe(false);
        const needed = requiredNumbersForVolume(volume5k, TCPA_WINDOW_HOURS, '10dlc', 'low');
        expect(needed).toBe(3);
      }
    });

    it('medium trust: all volumes fit on 1 number', () => {
      for (const volume of volumes) {
        expect(canFitDailyVolume(volume, TCPA_WINDOW_HOURS, '10dlc', 'medium')).toBe(true);
        expect(requiredNumbersForVolume(volume, TCPA_WINDOW_HOURS, '10dlc', 'medium')).toBe(1);
      }
    });

    it('high trust: all volumes fit on 1 number', () => {
      for (const volume of volumes) {
        expect(canFitDailyVolume(volume, TCPA_WINDOW_HOURS, '10dlc', 'high')).toBe(true);
        expect(requiredNumbersForVolume(volume, TCPA_WINDOW_HOURS, '10dlc', 'high')).toBe(1);
      }
    });
  });

  describe('Real-world throughput scenarios', () => {
    it('a 13-hour TCPA window at low trust → ~2000 msgs max', () => {
      const config = DEFAULT_THROUGHPUT.low;
      const capacity = computeDailyCapacity(config, TCPA_WINDOW_HOURS);
      // Even with MPS=1 spread over 13h, T-Mobile cap is the bottleneck
      expect(capacity).toBe(2000);
    });

    it('6-hour send window (9am-3pm) still hits T-Mobile cap at low trust', () => {
      const config = DEFAULT_THROUGHPUT.low;
      const capacity = computeDailyCapacity(config, 6);
      // MPS=1 × 21600sec = 21600, but T-Mobile cap=2000 → result=2000
      expect(capacity).toBe(2000);
    });

    it('medium trust with reduced window: MPS is bottleneck', () => {
      const config = DEFAULT_THROUGHPUT.medium;
      const capacity = computeDailyCapacity(config, 1);
      // MPS=10 × 3600sec = 36000, vs T-Mobile cap=10000 → result=10000
      expect(capacity).toBe(10000);
    });

    it('high trust with tight window: MPS limit kicks in', () => {
      const config = DEFAULT_THROUGHPUT.high;
      const capacity = computeDailyCapacity(config, 0.5);
      // MPS=50 × 1800sec = 90000, but T-Mobile cap=50000 → result=50000
      expect(capacity).toBe(50000);
    });
  });

  describe('Edge cases and safety', () => {
    it('zero volume always fits', () => {
      expect(canFitDailyVolume(0, TCPA_WINDOW_HOURS, '10dlc', 'low')).toBe(true);
    });

    it('zero volume requires 0 numbers (ceil(0/cap) = 0)', () => {
      expect(requiredNumbersForVolume(0, TCPA_WINDOW_HOURS, '10dlc', 'low')).toBe(0);
    });

    it('massive volume requires proportional numbers', () => {
      const needed = requiredNumbersForVolume(100000, TCPA_WINDOW_HOURS, '10dlc', 'low');
      // 100000 / 2000 = 50
      expect(needed).toBe(50);
    });

    it('rounding: 2001 msgs at low trust requires 2 numbers', () => {
      const needed = requiredNumbersForVolume(2001, TCPA_WINDOW_HOURS, '10dlc', 'low');
      // ceil(2001 / 2000) = 2
      expect(needed).toBe(2);
    });

    it('rounding: 2000 msgs at low trust requires 1 number', () => {
      const needed = requiredNumbersForVolume(2000, TCPA_WINDOW_HOURS, '10dlc', 'low');
      // ceil(2000 / 2000) = 1
      expect(needed).toBe(1);
    });
  });
});
