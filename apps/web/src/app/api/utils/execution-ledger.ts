import sql from '@/app/api/utils/sql';

/**
 * EXECUTION LEDGER (governance Rule #4).
 *
 * Every runtime flow step records a row in `execution_runs`. This is the truth
 * layer: a step without a ledger entry is invalid. recordRun NEVER throws — a
 * ledger failure must not break the underlying flow, but it is logged so the
 * gap is visible.
 *
 * IMPORTANT (Rule #6): writing a ledger row is NOT a CI pass. `status` here
 * records runtime outcome only; final PASS/COMPLETE is decided by CI.
 */
export type LedgerStatus = 'in_progress' | 'pass' | 'fail' | 'blocked';

export type RecordRunInput = {
  task: string;
  flow: string;
  step: string;
  status: LedgerStatus;
  passed?: boolean;
  detail?: string;
  dbAssertion?: string;
  logAssertion?: string;
  runId?: string | null;
};

export async function recordRun(input: RecordRunInput): Promise<void> {
  const {
    task,
    flow,
    step,
    status,
    passed = status === 'pass',
    detail = null,
    dbAssertion = null,
    logAssertion = null,
    runId = null,
  } = input;

  try {
    await sql`
      INSERT INTO execution_runs
        (task, flow, step, status, passed, detail, db_assertion, log_assertion, run_id)
      VALUES
        (${task}, ${flow}, ${step}, ${status}, ${passed}, ${detail},
         ${dbAssertion}, ${logAssertion}, ${runId})
    `;
  } catch (error) {
    // Do not let a ledger write break the flow; surface it for observability.
    console.error('[execution-ledger] failed to record run', { flow, step, error });
  }
}
