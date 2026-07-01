import { describe, it, expect } from 'vitest';
import { computeReadiness, executionReadiness, type ReadinessInput } from '../readiness';

const FULL: ReadinessInput = {
  apiRoutesPresent: 13,
  apiRoutesExpected: 13,
  jobsTotal: 10,
  jobsCompleted: 10,
  jobsDead: 0,
  jobsStuck: 0,
  dbTablesPresent: 13,
  dbTablesExpected: 13,
  messagesSent: 10,
  messagesFailed: 0,
  uiFlowsPresent: 6,
  uiFlowsExpected: 6,
  logActionsPresent: 7,
  logActionsExpected: 7,
  flowsPassed: 3,
  flowsExpected: 3,
};

describe('computeReadiness', () => {
  it('scores a fully healthy system at 100', () => {
    const { score, categories } = computeReadiness(FULL);
    expect(score).toBe(100);
    expect(categories).toHaveLength(7);
  });

  it('weights sum to 100 across categories', () => {
    const { categories } = computeReadiness(FULL);
    const totalWeight = categories.reduce((s, c) => s + c.weight, 0);
    expect(totalWeight).toBe(100);
  });

  it('treats an untested system (no jobs/messages/flows) as unproven, not perfect', () => {
    const fresh: ReadinessInput = {
      ...FULL,
      jobsTotal: 0,
      jobsCompleted: 0,
      messagesSent: 0,
      messagesFailed: 0,
      flowsPassed: 0,
    };
    const { categories } = computeReadiness(fresh);
    expect(categories.find((c) => c.key === 'jobs')?.points).toBe(0);
    expect(categories.find((c) => c.key === 'messaging')?.points).toBe(0);
    expect(categories.find((c) => c.key === 'flows')?.points).toBe(0);
  });

  it('penalizes dead and stuck jobs', () => {
    const degraded: ReadinessInput = {
      ...FULL,
      jobsTotal: 10,
      jobsCompleted: 6,
      jobsDead: 3,
      jobsStuck: 1,
    };
    const { categories } = computeReadiness(degraded);
    const jobs = categories.find((c) => c.key === 'jobs');
    // (6 - (3+1)) / 10 = 0.2 ratio * 20 weight = 4 pts
    expect(jobs?.points).toBe(4);
  });

  it('scales messaging reliability by delivery ratio', () => {
    const half: ReadinessInput = { ...FULL, messagesSent: 5, messagesFailed: 5 };
    const { categories } = computeReadiness(half);
    const messaging = categories.find((c) => c.key === 'messaging');
    // 5/10 = 0.5 * 10 weight = 5
    expect(messaging?.points).toBe(5);
  });

  it('scores flows by pass rate', () => {
    const partial: ReadinessInput = { ...FULL, flowsPassed: 1, flowsExpected: 3 };
    const flows = computeReadiness(partial).categories.find((c) => c.key === 'flows');
    // 1/3 = 0.333 * 10 weight = 3 (rounded)
    expect(flows?.points).toBe(3);
  });

  it('never exceeds 100 or drops below 0', () => {
    const { score } = computeReadiness({
      ...FULL,
      jobsCompleted: 0,
      jobsDead: 100,
      jobsStuck: 100,
    });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe('executionReadiness', () => {
  it('scores a fully healthy system at 100', () => {
    const { score, categories } = computeReadiness(FULL);
    expect(score).toBe(100);
    expect(categories).toHaveLength(7);
  });

  it('weights sum to 100 across categories', () => {
    const { categories } = computeReadiness(FULL);
    const totalWeight = categories.reduce((s, c) => s + c.weight, 0);
    expect(totalWeight).toBe(100);
  });

  it('treats an untested system (no jobs/messages/flows) as unproven, not perfect', () => {
    const fresh: ReadinessInput = {
      ...FULL,
      jobsTotal: 0,
      jobsCompleted: 0,
      messagesSent: 0,
      messagesFailed: 0,
      flowsPassed: 0,
    };
    const { categories } = computeReadiness(fresh);
    expect(categories.find((c) => c.key === 'jobs')?.points).toBe(0);
    expect(categories.find((c) => c.key === 'messaging')?.points).toBe(0);
    expect(categories.find((c) => c.key === 'flows')?.points).toBe(0);
  });

  it('penalizes dead and stuck jobs', () => {
    const degraded: ReadinessInput = {
      ...FULL,
      jobsTotal: 10,
      jobsCompleted: 6,
      jobsDead: 3,
      jobsStuck: 1,
    };
    const { categories } = computeReadiness(degraded);
    const jobs = categories.find((c) => c.key === 'jobs');
    // (6 - (3+1)) / 10 = 0.2 ratio * 20 weight = 4 pts
    expect(jobs?.points).toBe(4);
  });

  it('scales messaging reliability by delivery ratio', () => {
    const half: ReadinessInput = { ...FULL, messagesSent: 5, messagesFailed: 5 };
    const { categories } = computeReadiness(half);
    const messaging = categories.find((c) => c.key === 'messaging');
    // 5/10 = 0.5 * 10 weight = 5
    expect(messaging?.points).toBe(5);
  });

  it('scores flows by pass rate', () => {
    const partial: ReadinessInput = { ...FULL, flowsPassed: 1, flowsExpected: 3 };
    const flows = computeReadiness(partial).categories.find((c) => c.key === 'flows');
    // 1/3 = 0.333 * 10 weight = 3 (rounded)
    expect(flows?.points).toBe(3);
  });

  it('never exceeds 100 or drops below 0', () => {
    const { score } = computeReadiness({
      ...FULL,
      jobsCompleted: 0,
      jobsDead: 100,
      jobsStuck: 100,
    });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe('executionReadiness (Rule #8 — passed/total from execution_runs)', () => {
  it('returns 0 with zero runs (structurally unverified, never guessed)', () => {
    expect(executionReadiness(0, 0)).toEqual({ score: 0, passed: 0, total: 0 });
  });

  it('computes a strict passed/total percentage', () => {
    expect(executionReadiness(3, 4).score).toBe(75);
    expect(executionReadiness(5, 5).score).toBe(100);
  });

  it('clamps passed to total and floors negatives', () => {
    expect(executionReadiness(10, 5).score).toBe(100);
    expect(executionReadiness(-2, 4)).toEqual({ score: 0, passed: 0, total: 4 });
  });
});
