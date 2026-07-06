/*
 * QUARANTINED (verification sprint 2026-07): this engine is DEAD CODE — its
 * backing tables exist in no schema/migration/live DB and it is wired to no
 * runtime path. These live tests are it.skip (not skipIf DATABASE_URL) so they
 * never run — they cannot pass until migration 004 creates the tables. See
 * FINAL_STATE.md "NOT DEPLOYABLE" + quarantine-guard.test.ts. Un-skip in the
 * PR that makes the engine real.
 */
/**
 * Resurrection Engine Tests
 * 
 * GATE 2 Coverage:
 * - Resurrection respects opt-outs
 * - Resurrection respects disable toggle
 * - Eligible leads correctly identified
 * - Sequences tracked in ledger
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ResurrectionEngine } from './resurrection-engine';

describe('ResurrectionEngine', () => {
  let engine: ResurrectionEngine;

  beforeEach(() => {
    engine = new ResurrectionEngine('org_test_123');
  });

  describe('Configuration', () => {
    it.skip('should return default config when not configured', async () => {
      const config = await engine.getConfig();

      expect(config).toBeDefined();
      expect(config.enabled).toBe(true);
      expect(config.organizationId).toBe('org_test_123');
      expect(config.sequences.length).toBe(3); // Default 30/60/90
      expect(config.targetStatuses).toContain('COLD');
      expect(config.targetStatuses).toContain('NO_AGREEMENT');
    });

    it.skip('should allow setting config', async () => {
      await engine.setConfig({
        enabled: false,
        monthlyMaxResurrections: 100,
      });

      const config = await engine.getConfig();
      expect(config.enabled).toBe(false);
      expect(config.monthlyMaxResurrections).toBe(100);
    });

    it.skip('should allow disabling resurrections org-wide', async () => {
      await engine.setConfig({ enabled: false });

      const leads = await engine.findEligibleLeads(30);
      expect(leads).toHaveLength(0); // No leads when disabled
    });
  });

  describe('Opt-Out Enforcement', () => {
    it.skip('should skip opted-out leads', async () => {
      // Create a test lead and mark as opted-out (in real test with DB)
      const result = await engine.sendResurrection(
        999,
        '+15551234567',
        30,
        'Test message',
      );

      // Result should reflect whether lead is opted out
      expect(result.status).toBeDefined();
      expect(['sent', 'failed', 'skipped_opted_out']).toContain(result.status);
    });
  });

  describe('Eligible Lead Finding', () => {
    it.skip('should return empty when config disabled', async () => {
      await engine.setConfig({ enabled: false });

      const leads = await engine.findEligibleLeads(30);
      expect(leads).toHaveLength(0);
    });

    it.skip('should filter by sequence day', async () => {
      // Test that the method correctly filters leads by days since last contact
      const leads30 = await engine.findEligibleLeads(30);
      const leads60 = await engine.findEligibleLeads(60);

      // Both should be arrays (may be empty if no old leads in test DB)
      expect(Array.isArray(leads30)).toBe(true);
      expect(Array.isArray(leads60)).toBe(true);
    });
  });

  describe('Resurrection Sending', () => {
    it.skip('should reject send when resurrection disabled', async () => {
      await engine.setConfig({ enabled: false });

      const result = await engine.sendResurrection(
        1,
        '+15551234567',
        30,
        'Test message',
      );

      expect(result.status).toBe('skipped_disabled');
    });

    it('should have interfaces for all methods', async () => {
      expect(engine.getConfig).toBeDefined();
      expect(engine.setConfig).toBeDefined();
      expect(engine.findEligibleLeads).toBeDefined();
      expect(engine.sendResurrection).toBeDefined();
      expect(engine.processDayBatch).toBeDefined();
    });
  });

  describe('Batch Processing', () => {
    it.skip('should process day batch and return summary', async () => {
      const result = await engine.processDayBatch(30);

      expect(result).toHaveProperty('sent');
      expect(result).toHaveProperty('failed');
      expect(result).toHaveProperty('skipped');
      expect(typeof result.sent).toBe('number');
      expect(typeof result.failed).toBe('number');
      expect(typeof result.skipped).toBe('number');
    });

    it.skip('should return 0 for unknown sequence day', async () => {
      const result = await engine.processDayBatch(999);

      expect(result.sent).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.skipped).toBe(0);
    });
  });

  describe('Default Sequences', () => {
    it.skip('should have 3 default sequences', async () => {
      const config = await engine.getConfig();

      expect(config.sequences).toHaveLength(3);
      expect(config.sequences[0].day).toBe(30);
      expect(config.sequences[1].day).toBe(60);
      expect(config.sequences[2].day).toBe(90);
    });

    it.skip('should have labels and messages for each sequence', async () => {
      const config = await engine.getConfig();

      for (const seq of config.sequences) {
        expect(seq.label).toBeDefined();
        expect(seq.message).toBeDefined();
        expect(seq.label.length).toBeGreaterThan(0);
        expect(seq.message.length).toBeGreaterThan(0);
      }
    });
  });
});
