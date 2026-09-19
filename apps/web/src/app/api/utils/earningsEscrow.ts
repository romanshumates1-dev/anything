/**
 * Earnings Escrow Engine
 *
 * Handles the lifecycle of earnings from deals:
 * 1. PENDING -> AVAILABLE: When inspection period ends
 * 2. PENDING -> REFUNDED: When deal is refunded during inspection
 *
 * Also handles creating earnings when deals close.
 */

import sql from '@/app/api/utils/sql';
import { enqueueJob } from '@/app/api/utils/jobs';
import { randomUUID } from 'crypto';

const DEFAULT_HOLD_DAYS = 14; // Standard inspection period

export interface CreateEarningParams {
  userId: string;
  organizationId: string;
  contractId: string;
  amountCents: number;
  description?: string;
  holdDays?: number;
}

/**
 * Create an earning when a deal closes.
 * The earning starts in PENDING status and becomes AVAILABLE after the hold period.
 */
export async function createEarningForDeal(params: CreateEarningParams): Promise<{
  earningId: string;
  availableAt: Date;
}> {
  const {
    userId,
    organizationId,
    contractId,
    amountCents,
    description,
    holdDays = DEFAULT_HOLD_DAYS,
  } = params;

  // Check for existing earning
  const [existing] = await sql`
    SELECT id FROM earnings WHERE contract_id = ${contractId} LIMIT 1
  `;

  if (existing) {
    throw new Error(`Earning already exists for contract ${contractId}`);
  }

  const earningId = `earn_${randomUUID()}`;
  const now = new Date();
  const availableAt = new Date(now.getTime() + holdDays * 24 * 60 * 60 * 1000);

  await sql`
    INSERT INTO earnings (
      id, user_id, organization_id, contract_id, amount_cents,
      status, description, available_at, deal_closed_at
    )
    VALUES (
      ${earningId}, ${userId}, ${organizationId}, ${contractId}, ${amountCents},
      'PENDING', ${description || 'Deal assignment fee'}, ${availableAt}, ${now}
    )
  `;

  // Schedule job to release the earning
  await enqueueJob(
    'release_earning',
    { earningId },
    {
      runAt: availableAt,
      dedupeKey: `release_earning:${earningId}`,
    }
  );

  return { earningId, availableAt };
}

/**
 * Move a PENDING earning to AVAILABLE status.
 * Called by the scheduled job when the hold period expires.
 */
export async function releaseEarning(earningId: string): Promise<boolean> {
  const [earning] = await sql`
    SELECT id, status, available_at
    FROM earnings
    WHERE id = ${earningId}
    LIMIT 1
  `;

  if (!earning) {
    console.log(`[releaseEarning] Earning ${earningId} not found`);
    return false;
  }

  if (earning.status !== 'PENDING') {
    console.log(`[releaseEarning] Earning ${earningId} is ${earning.status}, not PENDING`);
    return false;
  }

  // Check if available_at has passed
  const now = new Date();
  if (new Date(earning.available_at) > now) {
    console.log(`[releaseEarning] Earning ${earningId} not yet available (${earning.available_at})`);
    return false;
  }

  await sql`
    UPDATE earnings
    SET status = 'AVAILABLE', updated_at = NOW()
    WHERE id = ${earningId}
      AND status = 'PENDING'
  `;

  console.log(`[releaseEarning] Released earning ${earningId}`);
  return true;
}

/**
 * Batch process: Move all PENDING earnings to AVAILABLE if their available_at has passed.
 * This is a fallback for any earnings that didn't get processed by their scheduled job.
 */
export async function processMaturedEarnings(): Promise<number> {
  const now = new Date();

  const result = await sql`
    UPDATE earnings
    SET status = 'AVAILABLE', updated_at = NOW()
    WHERE status = 'PENDING'
      AND available_at <= ${now}
    RETURNING id
  `;

  const count = result.length;
  if (count > 0) {
    console.log(`[processMaturedEarnings] Released ${count} matured earnings`);
  }

  return count;
}

/**
 * Refund an earning (deal fell through during inspection period).
 */
export async function refundEarning(
  earningId: string,
  reason: string,
  userId: string
): Promise<boolean> {
  const [earning] = await sql`
    SELECT id, status, amount_cents, contract_id
    FROM earnings
    WHERE id = ${earningId}
    LIMIT 1
  `;

  if (!earning) {
    return false;
  }

  if (earning.status !== 'PENDING') {
    throw new Error(`Cannot refund earning with status ${earning.status}`);
  }

  await sql`
    UPDATE earnings
    SET status = 'REFUNDED',
        refunded_at = NOW(),
        refund_reason = ${reason},
        updated_at = NOW()
    WHERE id = ${earningId}
  `;

  // Log the refund
  await sql`
    INSERT INTO audit_logs (user_id, action, target_type, target_id, payload)
    VALUES (
      ${userId},
      'earning_refunded',
      'earning',
      ${earningId},
      ${JSON.stringify({
        amount_cents: earning.amount_cents,
        contract_id: earning.contract_id,
        reason,
      })}
    )
  `;

  return true;
}

/**
 * Get balance summary for a user.
 */
export async function getUserBalanceSummary(userId: string, organizationId: string) {
  const [summary] = await sql`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'PENDING' THEN amount_cents ELSE 0 END), 0)::bigint as pending,
      COALESCE(SUM(CASE WHEN status = 'AVAILABLE' THEN amount_cents ELSE 0 END), 0)::bigint as available,
      COALESCE(SUM(CASE WHEN status = 'WITHDRAWN' THEN amount_cents ELSE 0 END), 0)::bigint as withdrawn,
      COALESCE(SUM(CASE WHEN status = 'REFUNDED' THEN amount_cents ELSE 0 END), 0)::bigint as refunded,
      COALESCE(SUM(CASE WHEN status IN ('AVAILABLE', 'WITHDRAWN') THEN amount_cents ELSE 0 END), 0)::bigint as total_earned
    FROM earnings
    WHERE user_id = ${userId}
      AND organization_id = ${organizationId}
  `;

  return {
    pending: Number(summary?.pending || 0),
    available: Number(summary?.available || 0),
    withdrawn: Number(summary?.withdrawn || 0),
    refunded: Number(summary?.refunded || 0),
    totalEarned: Number(summary?.total_earned || 0),
  };
}

/**
 * Hook to be called when a contract is marked CLOSED.
 * Creates the earning with escrow hold period.
 */
export async function onContractClosed(params: {
  contractId: string;
  organizationId: string;
  userId: string;
  assignmentFeeCents: number;
}): Promise<void> {
  const { contractId, organizationId, userId, assignmentFeeCents } = params;

  if (!assignmentFeeCents || assignmentFeeCents <= 0) {
    console.log(`[onContractClosed] No assignment fee for contract ${contractId}`);
    return;
  }

  // Get user's payout settings
  const [settings] = await sql`
    SELECT default_hold_days FROM payout_settings
    WHERE user_id = ${userId}
    LIMIT 1
  `;

  const holdDays = settings?.default_hold_days || DEFAULT_HOLD_DAYS;

  try {
    const { earningId, availableAt } = await createEarningForDeal({
      userId,
      organizationId,
      contractId,
      amountCents: assignmentFeeCents,
      holdDays,
    });

    console.log(
      `[onContractClosed] Created earning ${earningId} for contract ${contractId}, ` +
        `amount: $${assignmentFeeCents / 100}, available at: ${availableAt.toISOString()}`
    );
  } catch (error: any) {
    console.error(`[onContractClosed] Failed to create earning for contract ${contractId}:`, error);
  }
}
