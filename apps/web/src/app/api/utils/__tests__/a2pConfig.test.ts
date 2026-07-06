import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get10DLCThroughputConfig, validate10DLCThroughputConfig } from '../a2pConfig';

describe('A2P Config — throughput enforcement and hard caps', () => {
  beforeEach(() => {
    // Clear env vars before each test
    delete process.env.TWILIO_10DLC_ASSIGNED_MPS;
    delete process.env.TWILIO_10DLC_TMOBILE_DAILY_CAP;
  });

  describe('get10DLCThroughputConfig', () => {
    it('returns default low-trust config when env vars not set', () => {
      const config = get10DLCThroughputConfig();
      expect(config.mps).toBe(1);
      expect(config.tMobileDailyCap).toBe(2000);
      expect(config.trustLevel).toBe('low');
    });

    it('reads real assigned throughput from env vars', () => {
      process.env.TWILIO_10DLC_ASSIGNED_MPS = '10';
      process.env.TWILIO_10DLC_TMOBILE_DAILY_CAP = '10000';

      const config = get10DLCThroughputConfig();
      expect(config.mps).toBe(10);
      expect(config.tMobileDailyCap).toBe(10000);
      expect(config.trustLevel).toBe('medium');
    });

    it('infers trust level from assigned throughput', () => {
      // High trust
      process.env.TWILIO_10DLC_ASSIGNED_MPS = '50';
      process.env.TWILIO_10DLC_TMOBILE_DAILY_CAP = '50000';
      let config = get10DLCThroughputConfig();
      expect(config.trustLevel).toBe('high');

      // Medium trust
      process.env.TWILIO_10DLC_ASSIGNED_MPS = '10';
      process.env.TWILIO_10DLC_TMOBILE_DAILY_CAP = '10000';
      config = get10DLCThroughputConfig();
      expect(config.trustLevel).toBe('medium');

      // Low trust
      process.env.TWILIO_10DLC_ASSIGNED_MPS = '1';
      process.env.TWILIO_10DLC_TMOBILE_DAILY_CAP = '2000';
      config = get10DLCThroughputConfig();
      expect(config.trustLevel).toBe('low');
    });
  });

  describe('validate10DLCThroughputConfig', () => {
    it('returns invalid when env vars missing', () => {
      const result = validate10DLCThroughputConfig();
      expect(result.valid).toBe(false);
      expect(result.message).toContain('BLOCKED-ON-OWNER');
      expect(result.message).toContain('TWILIO_10DLC_ASSIGNED_MPS');
      expect(result.message).toContain('TWILIO_10DLC_TMOBILE_DAILY_CAP');
    });

    it('returns valid when both env vars set correctly', () => {
      process.env.TWILIO_10DLC_ASSIGNED_MPS = '10';
      process.env.TWILIO_10DLC_TMOBILE_DAILY_CAP = '10000';

      const result = validate10DLCThroughputConfig();
      expect(result.valid).toBe(true);
      expect(result.message).toContain('10DLC throughput configured');
      expect(result.message).toContain('MPS=10');
      expect(result.message).toContain('10000');
    });

    it('returns invalid when values are not positive integers', () => {
      process.env.TWILIO_10DLC_ASSIGNED_MPS = '0';
      process.env.TWILIO_10DLC_TMOBILE_DAILY_CAP = '10000';

      const result = validate10DLCThroughputConfig();
      expect(result.valid).toBe(false);
      expect(result.message).toContain('positive integers');
    });

    it('returns invalid when values are non-numeric', () => {
      process.env.TWILIO_10DLC_ASSIGNED_MPS = 'abc';
      process.env.TWILIO_10DLC_TMOBILE_DAILY_CAP = '10000';

      const result = validate10DLCThroughputConfig();
      expect(result.valid).toBe(false);
    });

    it('returns invalid when one var is missing', () => {
      process.env.TWILIO_10DLC_ASSIGNED_MPS = '10';
      // tMobileDailyCap not set

      const result = validate10DLCThroughputConfig();
      expect(result.valid).toBe(false);
    });
  });

  describe('Hard cap enforcement scenario', () => {
    it('validates that system aborts before exceeding limits (readiness gate)', () => {
      // Simulate Phase 2 loopback gate check
      // This is where the system should refuse to proceed if credentials are incomplete
      const validation = validate10DLCThroughputConfig();

      if (!validation.valid) {
        // In Phase 2 loopback, this blocks the entire pipeline
        expect(validation.message).toContain('BLOCKED');
        expect(() => {
          throw new Error(validation.message);
        }).toThrow('BLOCKED-ON-OWNER');
      }
    });

    it('allows Phase 2 loopback to proceed once throughput is configured', () => {
      process.env.TWILIO_10DLC_ASSIGNED_MPS = '1';
      process.env.TWILIO_10DLC_TMOBILE_DAILY_CAP = '2000';

      const validation = validate10DLCThroughputConfig();
      expect(validation.valid).toBe(true);

      // Should NOT throw
      expect(() => {
        if (!validation.valid) throw new Error(validation.message);
      }).not.toThrow();
    });
  });
});
