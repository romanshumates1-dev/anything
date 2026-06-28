/**
 * Deterministic readiness scoring engine (pure logic).
 *
 * The score is computed from real measurements supplied by the caller (route),
 * which gathers them from live DB queries + a static manifest of expected
 * routes/pages. This module contains NO fake/hardcoded health — every category
 * is a ratio of (present / expected) scaled by its weight.
 */

export type ReadinessInput = {
  // API completeness (20%)
  apiRoutesPresent: number;
  apiRoutesExpected: number;
  // Job system correctness (20%)
  jobsTotal: number;
  jobsCompleted: number;
  jobsDead: number;
  jobsStuck: number; // processing past lock expiry
  // DB integrity (20%)
  dbTablesPresent: number;
  dbTablesExpected: number;
  // Messaging reliability (15%)
  messagesSent: number;
  messagesFailed: number;
  // UI flow completeness (15%)
  uiFlowsPresent: number;
  uiFlowsExpected: number;
  // Observability + logging (10%)
  logActionsPresent: number;
  logActionsExpected: number;
  // Flow pass rate (10%) — proven end-to-end flows vs. registered flows
  flowsPassed: number;
  flowsExpected: number;
};

export type ReadinessCategory = {
  key: string;
  label: string;
  weight: number;
  ratio: number; // 0..1
  points: number; // ratio * weight, rounded
  detail: string;
};

export type ReadinessResult = {
  score: number; // 0..100
  categories: ReadinessCategory[];
};

export type ExecutionReadiness = {
  score: number; // 0..100, strictly passed/total
  passed: number;
  total: number;
};

const WEIGHTS = {
  api: 20,
  jobs: 20,
  db: 20,
  messaging: 10,
  ui: 15,
  observability: 5,
  flows: 10,
} as const;

function safeRatio(present: number, expected: number): number {
  if (expected <= 0) return 0;
  return Math.min(1, Math.max(0, present / expected));
}

export function computeReadiness(input: ReadinessInput): ReadinessResult {
  // Jobs: correctness = completed share, penalized by dead + stuck jobs.
  let jobsRatio: number;
  if (input.jobsTotal <= 0) {
    jobsRatio = 0;
  } else {
    const bad = input.jobsDead + input.jobsStuck;
    jobsRatio = Math.max(0, (input.jobsCompleted - bad) / input.jobsTotal);
    jobsRatio = Math.min(1, jobsRatio);
  }

  // Messaging: sent / (sent + failed). No traffic yet => 0 (unproven).
  const msgTotal = input.messagesSent + input.messagesFailed;
  const messagingRatio = msgTotal <= 0 ? 0 : input.messagesSent / msgTotal;

  const categories: ReadinessCategory[] = [
    {
      key: 'api',
      label: 'API completeness',
      weight: WEIGHTS.api,
      ratio: safeRatio(input.apiRoutesPresent, input.apiRoutesExpected),
      points: 0,
      detail: `${input.apiRoutesPresent}/${input.apiRoutesExpected} routes`,
    },
    {
      key: 'jobs',
      label: 'Job system correctness',
      weight: WEIGHTS.jobs,
      ratio: jobsRatio,
      points: 0,
      detail: `${input.jobsCompleted} completed, ${input.jobsDead} dead, ${input.jobsStuck} stuck of ${input.jobsTotal}`,
    },
    {
      key: 'db',
      label: 'DB integrity',
      weight: WEIGHTS.db,
      ratio: safeRatio(input.dbTablesPresent, input.dbTablesExpected),
      points: 0,
      detail: `${input.dbTablesPresent}/${input.dbTablesExpected} tables`,
    },
    {
      key: 'messaging',
      label: 'Messaging reliability',
      weight: WEIGHTS.messaging,
      ratio: messagingRatio,
      points: 0,
      detail:
        msgTotal <= 0 ? 'no messages sent yet' : `${input.messagesSent}/${msgTotal} delivered`,
    },
    {
      key: 'ui',
      label: 'UI flow completeness',
      weight: WEIGHTS.ui,
      ratio: safeRatio(input.uiFlowsPresent, input.uiFlowsExpected),
      points: 0,
      detail: `${input.uiFlowsPresent}/${input.uiFlowsExpected} flows`,
    },
    {
      key: 'observability',
      label: 'Observability + logging',
      weight: WEIGHTS.observability,
      ratio: safeRatio(input.logActionsPresent, input.logActionsExpected),
      points: 0,
      detail: `${input.logActionsPresent}/${input.logActionsExpected} event types seen`,
    },
    {
      key: 'flows',
      label: 'Flow pass rate',
      weight: WEIGHTS.flows,
      ratio: safeRatio(input.flowsPassed, input.flowsExpected),
      points: 0,
      detail: `${input.flowsPassed}/${input.flowsExpected} flows proven end-to-end`,
    },
  ];

  let score = 0;
  for (const c of categories) {
    c.points = Math.round(c.ratio * c.weight);
    score += c.points;
  }

  return { score: Math.min(100, score), categories };
}

/**
 * Governance Rule #8: readiness = passed / total FROM execution_runs.
 * Pure + deterministic. No AI input, no estimation. When no runs exist yet the
 * score is 0 (structurally unverified), never a guessed value.
 */
export function executionReadiness(passed: number, total: number): ExecutionReadiness {
  const safeTotal = Math.max(0, total);
  const safePassed = Math.max(0, Math.min(passed, safeTotal));
  const score = safeTotal === 0 ? 0 : Math.round((safePassed / safeTotal) * 100);
  return { score, passed: safePassed, total: safeTotal };
}
