/**
 * Comprehensive Tests for High-Volume Campaign Configuration
 *
 * Tests AWS Credit ID, warmup schedule, quality gates, and pacing.
 */

import { describe, it, expect } from 'vitest';
import {
  HIGH_VOLUME_CONFIG,
  getWarmupTarget,
  isInWarmup,
  getWarmupProgress,
  checkQualityGates,
  calculatePacing,
  estimateCost,
  estimateMonthlyCost,
  type CampaignMetrics,
} from '../high-volume';

describe('High-Volume Campaign Config', () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // CORE CONFIGURATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Core Configuration', () => {
    it('AWS Credit ID is 10064436819', () => {
      expect(HIGH_VOLUME_CONFIG.awsCreditId).toBe('10064436819');
      console.log(`✓ AWS Credit ID: ${HIGH_VOLUME_CONFIG.awsCreditId}`);
    });

    it('daily target is 150,000', () => {
      expect(HIGH_VOLUME_CONFIG.dailyTarget).toBe(150_000);
      console.log(`✓ Daily target: ${HIGH_VOLUME_CONFIG.dailyTarget.toLocaleString()}`);
    });

    it('max daily cap is 250,000', () => {
      expect(HIGH_VOLUME_CONFIG.maxDailyCap).toBe(250_000);
      console.log(`✓ Max daily cap: ${HIGH_VOLUME_CONFIG.maxDailyCap.toLocaleString()}`);
    });

    it('pacing per hour is 6,250 (150k / 24)', () => {
      expect(HIGH_VOLUME_CONFIG.pacingPerHour).toBe(6_250);
    });

    it('pacing per minute is 104 (6,250 / 60)', () => {
      expect(HIGH_VOLUME_CONFIG.pacingPerMinute).toBe(104);
    });

    it('burst limit is 500', () => {
      expect(HIGH_VOLUME_CONFIG.burstLimit).toBe(500);
    });

    it('provider is aws_ses', () => {
      expect(HIGH_VOLUME_CONFIG.provider).toBe('aws_ses');
    });

    it('estimated cost per 150k is ~$14', () => {
      expect(HIGH_VOLUME_CONFIG.estimatedCostPer150k).toBe(14);
      console.log(`✓ Cost per 150k: $${HIGH_VOLUME_CONFIG.estimatedCostPer150k}`);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // WARMUP SCHEDULE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Warmup Schedule', () => {
    it('has 7-day warmup schedule', () => {
      expect(HIGH_VOLUME_CONFIG.warmupSchedule.length).toBe(7);
    });

    it('Day 1 target is 10,000', () => {
      expect(getWarmupTarget(1)).toBe(10_000);
      console.log(`✓ Day 1: ${getWarmupTarget(1).toLocaleString()}`);
    });

    it('Day 2 target is 25,000', () => {
      expect(getWarmupTarget(2)).toBe(25_000);
    });

    it('Day 3 target is 50,000', () => {
      expect(getWarmupTarget(3)).toBe(50_000);
    });

    it('Day 4 target is 75,000', () => {
      expect(getWarmupTarget(4)).toBe(75_000);
      console.log(`✓ Day 4: ${getWarmupTarget(4).toLocaleString()}`);
    });

    it('Day 5 target is 100,000', () => {
      expect(getWarmupTarget(5)).toBe(100_000);
    });

    it('Day 6 target is 125,000', () => {
      expect(getWarmupTarget(6)).toBe(125_000);
    });

    it('Day 7 target is 150,000', () => {
      expect(getWarmupTarget(7)).toBe(150_000);
      console.log(`✓ Day 7: ${getWarmupTarget(7).toLocaleString()}`);
    });

    it('Day 8+ returns full daily target (150,000)', () => {
      expect(getWarmupTarget(8)).toBe(150_000);
      expect(getWarmupTarget(30)).toBe(150_000);
      console.log(`✓ Day 8+: ${getWarmupTarget(8).toLocaleString()}`);
    });

    it('Day 0 or negative returns 0', () => {
      expect(getWarmupTarget(0)).toBe(0);
      expect(getWarmupTarget(-1)).toBe(0);
    });
  });

  describe('Warmup Status', () => {
    it('Day 1-7 is in warmup', () => {
      expect(isInWarmup(1)).toBe(true);
      expect(isInWarmup(7)).toBe(true);
    });

    it('Day 8+ is not in warmup', () => {
      expect(isInWarmup(8)).toBe(false);
      expect(isInWarmup(30)).toBe(false);
    });

    it('warmup progress is correct', () => {
      expect(getWarmupProgress(1)).toBe(14); // 1/7 = 14%
      expect(getWarmupProgress(4)).toBe(57); // 4/7 = 57%
      expect(getWarmupProgress(7)).toBe(100); // 7/7 = 100%
      expect(getWarmupProgress(10)).toBe(100);
      console.log(`✓ Day 4 progress: ${getWarmupProgress(4)}%`);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // QUALITY GATES
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Quality Gates Configuration', () => {
    it('max bounce rate is 5% (0.05)', () => {
      expect(HIGH_VOLUME_CONFIG.qualityGates.maxBounceRate).toBe(0.05);
    });

    it('max complaint rate is 0.1% (0.001)', () => {
      expect(HIGH_VOLUME_CONFIG.qualityGates.maxComplaintRate).toBe(0.001);
    });

    it('max unsubscribe rate is 2% (0.02)', () => {
      expect(HIGH_VOLUME_CONFIG.qualityGates.maxUnsubscribeRate).toBe(0.02);
    });
  });

  describe('Quality Gate Checks', () => {
    it('passes with good metrics', () => {
      const metrics: CampaignMetrics = {
        sent: 10000,
        delivered: 9800,
        bounced: 200, // 2% < 5%
        complaints: 5, // 0.05% < 0.1%
        unsubscribes: 100, // 1% < 2%
        opens: 2000,
        clicks: 500,
      };
      const result = checkQualityGates(metrics);
      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.shouldPause).toBe(false);
      console.log(`✓ Good metrics pass: bounce=${(result.bounceRate * 100).toFixed(2)}%, complaints=${(result.complaintRate * 100).toFixed(3)}%`);
    });

    it('fails with bounce rate > 5%', () => {
      const metrics: CampaignMetrics = {
        sent: 10000,
        delivered: 9400,
        bounced: 600, // 6% > 5%
        complaints: 5,
        unsubscribes: 100,
        opens: 2000,
        clicks: 500,
      };
      const result = checkQualityGates(metrics);
      expect(result.passed).toBe(false);
      expect(result.shouldPause).toBe(true);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0]).toContain('Bounce rate');
      console.log(`✓ 6% bounce rate fails: ${result.violations[0]}`);
    });

    it('fails with complaint rate > 0.1%', () => {
      const metrics: CampaignMetrics = {
        sent: 10000,
        delivered: 9800,
        bounced: 200,
        complaints: 20, // 0.2% > 0.1%
        unsubscribes: 100,
        opens: 2000,
        clicks: 500,
      };
      const result = checkQualityGates(metrics);
      expect(result.passed).toBe(false);
      expect(result.violations.some(v => v.includes('Complaint rate'))).toBe(true);
      console.log(`✓ 0.2% complaint rate fails`);
    });

    it('fails with unsubscribe rate > 2%', () => {
      const metrics: CampaignMetrics = {
        sent: 10000,
        delivered: 9800,
        bounced: 200,
        complaints: 5,
        unsubscribes: 300, // 3% > 2%
        opens: 2000,
        clicks: 500,
      };
      const result = checkQualityGates(metrics);
      expect(result.passed).toBe(false);
      expect(result.violations.some(v => v.includes('Unsubscribe rate'))).toBe(true);
      console.log(`✓ 3% unsub rate fails`);
    });

    it('handles 0 sent (no division by zero)', () => {
      const metrics: CampaignMetrics = {
        sent: 0,
        delivered: 0,
        bounced: 0,
        complaints: 0,
        unsubscribes: 0,
        opens: 0,
        clicks: 0,
      };
      const result = checkQualityGates(metrics);
      expect(result.passed).toBe(true);
      expect(result.bounceRate).toBe(0);
    });

    it('accumulates multiple violations', () => {
      const metrics: CampaignMetrics = {
        sent: 10000,
        delivered: 9000,
        bounced: 800, // 8% > 5%
        complaints: 20, // 0.2% > 0.1%
        unsubscribes: 300, // 3% > 2%
        opens: 1000,
        clicks: 100,
      };
      const result = checkQualityGates(metrics);
      expect(result.passed).toBe(false);
      expect(result.violations.length).toBe(3);
      console.log(`✓ Multiple violations detected: ${result.violations.length} issues`);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PACING CALCULATOR
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Pacing Calculator', () => {
    it('allows sending when under all limits', () => {
      const result = calculatePacing(50, 3000, 80000, 8);
      expect(result.canSend).toBe(true);
      expect(result.sendCount).toBeGreaterThan(0);
      expect(result.waitMs).toBe(0);
      console.log(`✓ Under limits: can send ${result.sendCount} emails`);
    });

    it('blocks when daily target reached', () => {
      const result = calculatePacing(0, 0, 150000, 8); // Full 150k sent
      expect(result.canSend).toBe(false);
      expect(result.sendCount).toBe(0);
      expect(result.reason).toContain('Daily target reached');
      console.log(`✓ Daily limit reached: ${result.reason}`);
    });

    it('blocks when hourly limit reached', () => {
      const result = calculatePacing(0, 6250, 10000, 8); // Full hourly quota
      expect(result.canSend).toBe(false);
      expect(result.waitMs).toBe(60_000); // Wait 1 minute
      expect(result.reason).toContain('Hourly limit reached');
    });

    it('blocks when per-minute limit reached', () => {
      const result = calculatePacing(104, 500, 1000, 8); // Full minute quota
      expect(result.canSend).toBe(false);
      expect(result.waitMs).toBe(5_000); // Wait 5 seconds
      expect(result.reason).toContain('Per-minute limit reached');
    });

    it('respects warmup day target', () => {
      // Day 1 target is 10k
      const result1 = calculatePacing(0, 0, 10000, 1); // At day 1 limit
      expect(result1.canSend).toBe(false);
      expect(result1.reason).toContain('Daily target reached');

      // Day 4 target is 75k
      const result4 = calculatePacing(0, 0, 74000, 4); // Under day 4 limit
      expect(result4.canSend).toBe(true);
    });

    it('send count respects burst limit (500)', () => {
      const result = calculatePacing(0, 0, 0, 8);
      expect(result.sendCount).toBeLessThanOrEqual(500);
    });

    it('send count respects remaining daily', () => {
      const result = calculatePacing(0, 0, 149800, 8); // Only 200 remaining
      // But also limited by per-minute (104) - takes minimum of all limits
      expect(result.sendCount).toBeLessThanOrEqual(200);
      expect(result.sendCount).toBe(104); // per-minute limit kicks in
      console.log(`✓ Send count respects all limits: ${result.sendCount}`);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // COST ESTIMATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Cost Estimation', () => {
    it('150k emails = $14', () => {
      const cost = estimateCost(150_000);
      expect(cost).toBe(14);
      console.log(`✓ 150k emails = $${cost}`);
    });

    it('300k emails = $28', () => {
      const cost = estimateCost(300_000);
      expect(cost).toBe(28);
      console.log(`✓ 300k emails = $${cost}`);
    });

    it('75k emails = $7', () => {
      const cost = estimateCost(75_000);
      expect(cost).toBe(7);
    });

    it('monthly cost at full volume = ~$420', () => {
      const monthlyCost = estimateMonthlyCost();
      // 150k * 30 days = 4.5M emails / 150k = 30 batches * $14 = $420
      expect(monthlyCost).toBe(420);
      console.log(`✓ Monthly cost at 150k/day: $${monthlyCost}`);
    });
  });
});
