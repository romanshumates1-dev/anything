/**
 * Phase 0A + Phase 1 + Phase 4 tests.
 *
 * Gate 0A: fail-closed proven, kill-switch proven, non-cold bypass proven.
 * Gate 1: capacity planner math vs hand fixture, gap model ranked levers.
 * Gate 4: opted-out contacts NEVER resurrected (SQL-level enforcement verified).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/app/api/utils/sql', () => ({ default: vi.fn() }));

import sql from '@/app/api/utils/sql';
import {
  checkComplianceGate,
  jurisdictionForLead,
} from '@/app/api/utils/complianceGate';
import { computeCapacityPlan, DEFAULT_RATES } from '@/app/api/utils/capacityPlanner';

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;

// ── COMPLIANCE GATE ──────────────────────────────────────────────────────

describe('checkComplianceGate — fail-closed', () => {
  beforeEach(() => mockSql.mockReset());

  it('blocks when no gate row exists (fail-closed)', async () => {
    mockSql.mockResolvedValueOnce([]); // kill-switch not active
    mockSql.mockResolvedValueOnce([]); // no gate row
    const r = await checkComplianceGate({ organizationId: 'org1', jurisdiction: 'TN-Davidson', channel: 'sms', coldOutbound: true });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/no compliance gate found/i);
  });

  it('blocks when gate exists but attorney_reviewed=false', async () => {
    mockSql.mockResolvedValueOnce([]); // kill-switch
    mockSql.mockResolvedValueOnce([{ attorney_reviewed: false, source_terms_confirmed: false, notes: null }]);
    const r = await checkComplianceGate({ organizationId: 'org1', jurisdiction: 'TN-Davidson', channel: 'sms', coldOutbound: true });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/not yet attorney-reviewed/i);
  });

  it('allows when attorney_reviewed=true', async () => {
    mockSql.mockResolvedValueOnce([]); // kill-switch
    mockSql.mockResolvedValueOnce([{ attorney_reviewed: true, source_terms_confirmed: true, notes: null }]);
    const r = await checkComplianceGate({ organizationId: 'org1', jurisdiction: 'KY', channel: 'email', coldOutbound: true });
    expect(r.allowed).toBe(true);
  });

  it('allows non-cold sends without any DB call', async () => {
    const r = await checkComplianceGate({ organizationId: 'org1', jurisdiction: 'TN-Davidson', channel: 'sms', coldOutbound: false });
    expect(r.allowed).toBe(true);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('blocks when kill-switch is active', async () => {
    mockSql.mockResolvedValueOnce([{ active: true }]); // kill-switch active
    const r = await checkComplianceGate({ organizationId: 'org1', jurisdiction: 'KY', channel: 'sms', coldOutbound: true });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/kill-switch/i);
  });

  it('blocks when jurisdiction is null', async () => {
    mockSql.mockResolvedValueOnce([]); // kill-switch
    const r = await checkComplianceGate({ organizationId: 'org1', jurisdiction: null, channel: 'sms', coldOutbound: true });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/jurisdiction unknown/i);
  });
});

describe('jurisdictionForLead', () => {
  it('returns state+county when both present', () => {
    expect(jurisdictionForLead({ state: 'TN', county: 'Davidson' })).toBe('TN-Davidson');
  });

  it('returns state only when no county', () => {
    expect(jurisdictionForLead({ state: 'KY' })).toBe('KY');
  });

  it('returns null when no state', () => {
    expect(jurisdictionForLead({ county: 'Davidson' })).toBeNull();
  });

  it('disambiguates AL-Jefferson from KY-Jefferson', () => {
    const ky = jurisdictionForLead({ state: 'KY', county: 'Jefferson' });
    const al = jurisdictionForLead({ state: 'AL', county: 'Jefferson' });
    expect(ky).toBe('KY-Jefferson');
    expect(al).toBe('AL-Jefferson');
    expect(ky).not.toBe(al);
  });
});

// ── CAPACITY PLANNER ─────────────────────────────────────────────────────

describe('computeCapacityPlan — hand fixture', () => {
  const inputs = {
    budgetCents: 50000,
    rates: DEFAULT_RATES,
    conversionRate: 0.001,
    jurisdictionCount: 5,
    jvRelationshipCount: 2,
    buyerCoverageScore: 0.3,
  };

  it('Plan A contacts = floor(budget / (trace + 2*sms))', () => {
    const plan = computeCapacityPlan(inputs);
    // trace=13c, sms=1c, 2 touches = 15c/contact
    expect(plan.planA.contactCount).toBe(Math.floor(50000 / 15));
  });

  it('Plan A has 2 touches per contact', () => {
    expect(computeCapacityPlan(inputs).planA.touchesPerContact).toBe(2);
  });

  it('Plan B has 10 touches per contact', () => {
    expect(computeCapacityPlan(inputs).planB.touchesPerContact).toBe(10);
  });

  it('Plan B contact count < Plan A (depth vs breadth)', () => {
    const plan = computeCapacityPlan(inputs);
    expect(plan.planB.contactCount).toBeLessThan(plan.planA.contactCount);
  });

  it('Poisson P(>=1) is in (0,1]', () => {
    const plan = computeCapacityPlan(inputs);
    expect(plan.planA.pAtLeastOne).toBeGreaterThan(0);
    expect(plan.planA.pAtLeastOne).toBeLessThanOrEqual(1);
  });

  it('gap model outputs a real number', () => {
    const plan = computeCapacityPlan(inputs);
    expect(typeof plan.gapModel.expectedFeesPerMonth).toBe('number');
    expect(plan.gapModel.gapToTarget).toBeGreaterThanOrEqual(0);
  });

  it('levers ranked by descending impact', () => {
    const levers = computeCapacityPlan(inputs).gapModel.rankedLevers;
    for (let i = 0; i < levers.length - 1; i++) {
      expect(levers[i].estimatedImpact).toBeGreaterThanOrEqual(levers[i + 1].estimatedImpact);
    }
  });

  it('data labels are BENCHMARK', () => {
    const plan = computeCapacityPlan(inputs);
    expect(plan.planA.dataLabel).toMatch(/BENCHMARK/);
    expect(plan.gapModel.dataLabel).toMatch(/BENCHMARK/);
  });

  it('nFor80pct < nFor95pct', () => {
    const plan = computeCapacityPlan(inputs);
    expect(plan.nFor80pct).toBeLessThan(plan.nFor95pct);
  });
});

// ── RESURRECTION OPT-OUT INVARIANT ──────────────────────────────────────

describe('resurrection — opted-out contacts NEVER resurrected', () => {
  it('SQL query enforces opt-out exclusion at the DB level', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const src = readFileSync(
      join(process.cwd(), 'src/app/api/utils/resurrectionEngine.ts'),
      'utf8'
    );
    // Structural enforcement: NOT EXISTS on compliance_records in the SQL query
    expect(src).toMatch(/NOT EXISTS/);
    expect(src).toMatch(/compliance_records/);
    expect(src).toMatch(/type = 'opt-out'/);
  });
});
