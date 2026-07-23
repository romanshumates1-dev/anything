/**
 * Phase V-R — inspection urgency SERVER half (job scheduling + handler).
 * Pure clock math lives in inspectionClockCore.ts (client-safe, shared with
 * the UI chip); this file re-exports it so existing imports keep working.
 */
import sql from '@/app/api/utils/sql';
import { enqueueJob } from '@/app/api/utils/jobs';
import { logEvent } from '@/app/api/utils/logger';
import { DEFAULT_FEE_FLOOR } from './valuationEngine';
import { lowestViableAsk } from './inspectionClockCore';

export * from './inspectionClockCore';

/** Enqueue both urgency jobs at contract creation — idempotent via dedupe keys
 *  (`inspect:{id}:day3` / `inspect:{id}:final`), so re-generation or a worker
 *  restart can never double-fire. Fresh assigned/status checks happen at FIRE
 *  time, not schedule time (same doctrine as dispatchGate). */
export async function scheduleInspectionUrgency(contractId: string, organizationId: string, createdAt: Date, inspectionDays: number): Promise<void> {
  const day3 = new Date(createdAt.getTime() + 3 * 86_400_000);
  const final = new Date(createdAt.getTime() + Math.max(1, inspectionDays - 2) * 86_400_000);
  await enqueueJob('inspection_urgency', { contractId, organizationId, kind: 'day3' }, { runAt: day3, dedupeKey: `inspect:${contractId}:day3` });
  await enqueueJob('inspection_urgency', { contractId, organizationId, kind: 'final' }, { runAt: final, dedupeKey: `inspect:${contractId}:final` });
}

/** Job handler (jobs.ts case 'inspection_urgency'). Exactly-once by
 *  construction: the dedupe key means one job row per (contract, kind), and the
 *  handler re-checks state at fire time. */
export async function processInspectionUrgency(payload: { contractId: string; organizationId: string; kind: 'day3' | 'final' }): Promise<{ notified: boolean; reason: string }> {
  const [contract] = await sql`
    SELECT id, status, assigned_at, inspection_days, contract_price_cents, created_at
    FROM contracts WHERE id = ${payload.contractId}
  `;
  if (!contract) return { notified: false, reason: 'contract_deleted' };
  if (contract.assigned_at) return { notified: false, reason: 'already_assigned' };
  if (['VOID', 'CANCELLED', 'EXPIRED'].includes(contract.status)) return { notified: false, reason: `terminal:${contract.status}` };

  let context: Record<string, unknown>;
  let type: string;
  if (payload.kind === 'day3') {
    type = 'INSPECTION_DAY3';
    context = {
      message: 'No buyer traction by day 3 — review price/spread.',
      link: `/contracts`,
    };
  } else {
    type = 'INSPECTION_FINAL';
    const viable = lowestViableAsk(contract.contract_price_cents != null ? Number(contract.contract_price_cents) : null);
    context = viable
      ? {
          message: `Inspection window closes in 2 days and the contract is unassigned. You can drop the buyer ask to ${'$' + (viable.lowestAskCents / 100).toLocaleString('en-US')} and still clear the $${DEFAULT_FEE_FLOOR.toLocaleString('en-US')} floor.`,
          lowestViableAskCents: viable.lowestAskCents,
          link: `/contracts`,
        }
      : {
          message: 'Inspection window closes in 2 days, the contract is unassigned, and no ask clears the fee floor (or the contract price is unrecorded). Recommend exit or renegotiation.',
          link: `/contracts`,
        };
  }

  await sql`
    INSERT INTO human_approvals (id, organization_id, type, contract_id, context, status)
    VALUES (${crypto.randomUUID()}, ${payload.organizationId}, ${type}, ${payload.contractId}, ${JSON.stringify(context)}, 'PENDING')
  `;
  await logEvent(`inspection_${payload.kind}`, 'contract', payload.contractId, context, payload.organizationId);
  return { notified: true, reason: payload.kind };
}
