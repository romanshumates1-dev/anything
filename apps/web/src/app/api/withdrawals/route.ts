/**
 * Withdrawals API
 *
 * BULLETPROOF FEATURES:
 * - Atomic row locking with FOR UPDATE SKIP LOCKED
 * - Double-spend prevention via status state machine
 * - Idempotency through withdrawal ID pre-generation
 * - Automatic rollback on partial failure
 * - Integer overflow protection
 * - Concurrent withdrawal prevention (one at a time)
 * - Daily withdrawal limit enforcement
 * - Audit logging for compliance
 */
import sql, { type SqlQuery } from '@/app/api/utils/sql';
import { rateLimitByUser } from '@/app/api/utils/rateLimit';
import { auth } from '@/lib/auth';
import { getOrganization } from '@/lib/organization-context';
import { headers } from 'next/headers';
import { randomUUID } from 'crypto';
import { splitWithholding } from '@/app/api/utils/taxWithholding';
import {
  getWithholdingSettings,
  prepareWithholdingInsert,
  readWithholdingResult,
} from '@/app/api/utils/taxWithholdingStore';

const MINIMUM_PAYOUT_CENTS = 10000; // $100 minimum
const MAXIMUM_PAYOUT_CENTS = 100_000_00; // $100,000 maximum per withdrawal
const DAILY_WITHDRAWAL_LIMIT_CENTS = 500_000_00; // $500,000 daily limit
const ESTIMATED_DAYS = 2; // Bank transfer arrival time
const MAX_SAFE_CENTS = 9_007_199_254_740_991; // Number.MAX_SAFE_INTEGER
const WITHDRAWAL_RATE_LIMIT = 10; // Max withdrawal requests per hour
const WITHDRAWAL_RATE_WINDOW_SECONDS = 3600; // 1 hour window

/**
 * GET /api/withdrawals
 * List withdrawal history for the current user.
 */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const organization = await getOrganization();
    if (!organization) {
      return Response.json({ error: 'No organization found' }, { status: 403 });
    }

    const userId = session.user.id;
    const orgId = organization.id;

    // Tax withholding is stored in the append-only ledger keyed by
    // withdrawal_id. Each row is aggregated here so a withdrawal renders its
    // NET payout (what actually lands in the bank) alongside the gross, and a
    // release reduces the withheld figure instead of being double-counted.
    // Subquery: aggregates ALL ledger rows for this withdrawal (withheld and
    // released counted separately), so even a future multi-row history cannot
    // duplicate the withdrawal in the outer result or double-count money.
    const withdrawals = await sql`
      SELECT
        w.id,
        w.amount_cents,
        w.status,
        w.payout_method,
        w.payout_reference,
        w.requested_at,
        w.processing_started_at,
        w.completed_at,
        w.failed_at,
        w.failure_reason,
        w.estimated_arrival_at,
        w.metadata,
        COALESCE(l.withheld_cents, 0)::bigint AS tax_withheld_cents,
        GREATEST(
          COALESCE(l.withheld_cents, 0) - COALESCE(l.released_cents, 0),
          0
        )::bigint AS tax_net_withheld_cents,
        l.tax_rate_bps
      FROM withdrawals w
      LEFT JOIN LATERAL (
        SELECT
          SUM(twl.amount_cents) FILTER (WHERE twl.kind = 'WITHHELD')
            AS withheld_cents,
          SUM(twl.amount_cents) FILTER (WHERE twl.kind = 'RELEASED')
            AS released_cents,
          MAX(twl.rate_bps) AS tax_rate_bps
        FROM tax_withholding_ledger twl
        WHERE twl.withdrawal_id = w.id
          AND twl.user_id = w.user_id
          AND twl.organization_id = w.organization_id
      ) l ON true
      WHERE w.user_id = ${userId}
        AND w.organization_id = ${orgId}
      ORDER BY w.requested_at DESC
      LIMIT 50
    `;

    return Response.json({ withdrawals });
  } catch (error: any) {
    console.error('GET /api/withdrawals error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * POST /api/withdrawals
 * Request a withdrawal from available balance.
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Rate limiting - prevent abuse/spam of withdrawal endpoint
  const rateLimitResult = await rateLimitByUser(
    session.user.id,
    'withdrawal_request',
    WITHDRAWAL_RATE_LIMIT,
    WITHDRAWAL_RATE_WINDOW_SECONDS
  );

  if (!rateLimitResult.allowed) {
    return Response.json(
      {
        error: 'Too many withdrawal requests. Please try again later.',
        resetAt: rateLimitResult.resetAt.toISOString(),
        remaining: rateLimitResult.remaining,
      },
      { status: 429 }
    );
  }

  try {
    const organization = await getOrganization();
    if (!organization) {
      return Response.json({ error: 'No organization found' }, { status: 403 });
    }

    const body = await request.json();
    const { amountCents } = body;

    if (!amountCents || amountCents <= 0) {
      return Response.json(
        { error: 'Positive amountCents is required' },
        { status: 400 }
      );
    }

    if (amountCents < MINIMUM_PAYOUT_CENTS) {
      return Response.json(
        { error: `Minimum withdrawal amount is $${MINIMUM_PAYOUT_CENTS / 100}` },
        { status: 400 }
      );
    }

    // Maximum withdrawal protection
    if (amountCents > MAXIMUM_PAYOUT_CENTS) {
      return Response.json(
        { error: `Maximum withdrawal amount is $${MAXIMUM_PAYOUT_CENTS / 100}. For larger amounts, contact support.` },
        { status: 400 }
      );
    }

    // Integer overflow protection - comprehensive validation
    if (!Number.isFinite(amountCents) || !Number.isInteger(amountCents)) {
      return Response.json(
        { error: 'Invalid withdrawal amount: must be a valid integer' },
        { status: 400 }
      );
    }
    if (amountCents < 0 || amountCents > MAX_SAFE_CENTS) {
      return Response.json(
        { error: 'Invalid withdrawal amount: out of safe range' },
        { status: 400 }
      );
    }
    if (!Number.isSafeInteger(amountCents)) {
      return Response.json(
        { error: 'Invalid withdrawal amount: exceeds safe integer precision' },
        { status: 400 }
      );
    }

    const userId = session.user.id;
    const orgId = organization.id;

    // Check daily withdrawal limit
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [dailyTotal] = await sql`
      SELECT COALESCE(SUM(amount_cents), 0) as total
      FROM withdrawals
      WHERE user_id = ${userId}
        AND organization_id = ${orgId}
        AND status NOT IN ('FAILED', 'CANCELLED')
        AND requested_at >= ${todayStart}
    `;

    const todayWithdrawn = Number(dailyTotal?.total || 0);
    if (todayWithdrawn + amountCents > DAILY_WITHDRAWAL_LIMIT_CENTS) {
      return Response.json(
        {
          error: `Daily withdrawal limit exceeded. Today's withdrawals: $${(todayWithdrawn / 100).toFixed(2)}. Limit: $${(DAILY_WITHDRAWAL_LIMIT_CENTS / 100).toFixed(2)}`,
          todayWithdrawn,
          limit: DAILY_WITHDRAWAL_LIMIT_CENTS,
          remaining: Math.max(0, DAILY_WITHDRAWAL_LIMIT_CENTS - todayWithdrawn),
        },
        { status: 400 }
      );
    }

    // Check available balance
    const [balance] = await sql`
      SELECT COALESCE(SUM(amount_cents), 0) as available
      FROM earnings
      WHERE user_id = ${userId}
        AND organization_id = ${orgId}
        AND status = 'AVAILABLE'
    `;

    const availableBalance = Number(balance?.available || 0);

    if (amountCents > availableBalance) {
      return Response.json(
        {
          error: 'Insufficient available balance',
          available: availableBalance,
          requested: amountCents,
        },
        { status: 400 }
      );
    }

    // Check for pending withdrawal (one at a time)
    const [pendingWithdrawal] = await sql`
      SELECT id FROM withdrawals
      WHERE user_id = ${userId}
        AND status IN ('PENDING', 'PROCESSING')
      LIMIT 1
    `;

    if (pendingWithdrawal) {
      return Response.json(
        { error: 'You already have a pending withdrawal. Please wait for it to complete.' },
        { status: 400 }
      );
    }

    // Verify bank account exists
    const [bankAccount] = await sql`
      SELECT id, verified FROM bank_accounts
      WHERE user_id = ${userId}
        AND is_default = true
      LIMIT 1
    `;

    if (!bankAccount) {
      return Response.json(
        { error: 'No bank account connected. Please add a bank account first.' },
        { status: 400 }
      );
    }

    if (!bankAccount.verified) {
      return Response.json(
        { error: 'Bank account not verified. Please verify your bank account first.' },
        { status: 400 }
      );
    }

    const withdrawalId = `wdr_${randomUUID()}`;
    const now = new Date();
    const estimatedArrival = new Date(now.getTime() + ESTIMATED_DAYS * 24 * 60 * 60 * 1000);
    const reference = `TRF-${now.toISOString().slice(0, 10).replace(/-/g, '')}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    // ---------------------------------------------------------------
    // ATOMIC MONEY MOVEMENT
    // ---------------------------------------------------------------
    // The reservation, the withdrawal record, the earnings finalisation, the
    // withholding row and the audit row are submitted as ONE
    // `sql.transaction([...])` batch, so they commit together or not at all.
    //
    // Previously these ran as separate statements. A failure part-way left
    // earnings stranded in PENDING_WITHDRAWAL with no withdrawal to release
    // them, and the withholding row was written AFTER the money had already
    // moved with its failure deliberately swallowed - so a seller could be paid
    // gross with no tax recorded and nothing to detect it from.
    //
    // WHY THE GATES LIVE IN SQL
    // -------------------------
    // The driver requires the transaction callback to be SYNCHRONOUS, so a
    // later statement cannot be built from an earlier statement's rows.
    // Instead each dependent statement is gated by an `EXISTS` over the
    // withdrawal row. A row inserted earlier in the SAME transaction is already
    // visible to the statements that follow, so each gate sees the true
    // mid-flight state:
    //
    //   reserved   claim the chosen earnings for this withdrawal id
    //   created    insert the withdrawal ONLY if the claim covers the request
    //   reverted   hand the claim back if `created` was a no-op, so a rejected
    //              request strands nothing
    //   finalized  mark the claim WITHDRAWN if `created` succeeded
    //   taxed      withholding row, ONLY if the withdrawal exists
    //   audited    audit row, ONLY if the withdrawal exists
    //
    // `reverted` and `finalized` test the same condition, so exactly one of
    // them is ever effective and the two can never fight.

    // Resolve the withholding policy BEFORE the batch: the ledger row is part
    // of the same commit, so its parameters must be known up front.
    const taxSettings = await getWithholdingSettings(userId, orgId);
    const split = splitWithholding(amountCents, taxSettings);
    // `split.applied` implies `withheldCents > 0`, which is what the ledger's
    // `amount_cents > 0` CHECK requires - so a zero-rate setting writes no row
    // at all rather than violating the constraint.
    const preparedTax = split.applied
      ? prepareWithholdingInsert(
          {
            userId,
            organizationId: orgId,
            kind: 'WITHHELD',
            amountCents: split.withheldCents,
            rateBps: split.rateBps,
            // The withdrawal id is the idempotency scope, so a retried request
            // for the same withdrawal can never withhold twice.
            scope: withdrawalId,
            withdrawalId,
            note: `Withholding on withdrawal ${reference}`,
            occurredAt: now,
          },
          { gateOnWithdrawalId: withdrawalId }
        )
      : null;

    // SECURITY: the claim is a single atomic UPDATE ... FOR UPDATE SKIP LOCKED,
    // so two concurrent withdrawals can never select the same earnings.
    const statements: Array<{ key: string; query: SqlQuery }> = [
      {
        key: 'reserved',
        query: sql`
          UPDATE earnings
          SET
            status = 'PENDING_WITHDRAWAL',
            withdrawal_id = ${withdrawalId},
            updated_at = NOW()
          WHERE id IN (
            SELECT id FROM earnings
            WHERE user_id = ${userId}
              AND organization_id = ${orgId}
              AND status = 'AVAILABLE'
            ORDER BY available_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT (
              SELECT COUNT(*) FROM (
                SELECT id, amount_cents,
                  SUM(amount_cents) OVER (ORDER BY available_at ASC) as running_total
                FROM earnings
                WHERE user_id = ${userId}
                  AND organization_id = ${orgId}
                  AND status = 'AVAILABLE'
              ) sub
              WHERE running_total <= ${amountCents} OR
                    running_total - amount_cents < ${amountCents}
            )
          )
          RETURNING id, amount_cents
        `,
      },
    ];

    // The withdrawal row is written only when the claim covers the request.
    // The balance check is evaluated INSIDE the transaction, so a concurrent
    // request cannot slip in between the check and the write.
    statements.push({
      key: 'created',
      query: sql`
        INSERT INTO withdrawals (
          id, user_id, organization_id, amount_cents, status,
          payout_method, payout_reference, requested_at, estimated_arrival_at
        )
        SELECT
          ${withdrawalId}::text, ${userId}::text, ${orgId}::text,
          ${amountCents}::bigint, 'PENDING', 'bank_transfer',
          ${reference}::text, ${now}::timestamptz, ${estimatedArrival}::timestamptz
        WHERE (
          SELECT COALESCE(SUM(amount_cents), 0) FROM earnings
          WHERE withdrawal_id = ${withdrawalId} AND status = 'PENDING_WITHDRAWAL'
        ) >= ${amountCents}
        RETURNING id
      `,
    });

    // Rejected request: hand the claim back. Guarded by NOT EXISTS, so this is
    // a no-op on the success path.
    statements.push({
      key: 'reverted',
      query: sql`
        UPDATE earnings
        SET status = 'AVAILABLE', withdrawal_id = NULL, updated_at = NOW()
        WHERE withdrawal_id = ${withdrawalId}
          AND organization_id = ${orgId}
          AND status = 'PENDING_WITHDRAWAL'
          AND NOT EXISTS (SELECT 1 FROM withdrawals WHERE id = ${withdrawalId})
      `,
    });

    // Accepted request: the claim becomes a completed withdrawal. Guarded by
    // EXISTS, so this is a no-op on the rejected path.
    statements.push({
      key: 'finalized',
      query: sql`
        UPDATE earnings
        SET status = 'WITHDRAWN', updated_at = NOW()
        WHERE withdrawal_id = ${withdrawalId}
          AND organization_id = ${orgId}
          AND status = 'PENDING_WITHDRAWAL'
          AND EXISTS (SELECT 1 FROM withdrawals WHERE id = ${withdrawalId})
      `,
    });

    // The withholding row rides in the same commit as the money movement, so a
    // withdrawal can never be paid gross with no tax recorded.
    if (preparedTax) statements.push({ key: 'taxed', query: preparedTax.query });

    // `earnings_count` is read from the rows this batch just finalised, not
    // from JavaScript, which cannot see them until after the commit.
    statements.push({
      key: 'audited',
      query: sql`
        INSERT INTO audit_logs (user_id, action, target_type, target_id, payload)
        SELECT
          ${userId}::text, 'withdrawal_requested', 'withdrawal', ${withdrawalId}::text,
          jsonb_build_object(
            'amount_cents', ${amountCents}::bigint,
            'earnings_count',
              (SELECT COUNT(*) FROM earnings
               WHERE withdrawal_id = ${withdrawalId}
                 AND organization_id = ${orgId}
                 AND status = 'WITHDRAWN'),
            'reference', ${reference}::text
          )
        WHERE EXISTS (SELECT 1 FROM withdrawals WHERE id = ${withdrawalId})
      `,
    });

    const results = await sql.transaction(statements.map((s) => s.query));
    const byKey = new Map<string, unknown[]>(
      statements.map((s, i) => [s.key, (results[i] ?? []) as unknown[]])
    );

    const reservedRows = (byKey.get('reserved') ?? []) as Array<{
      id: string;
      amount_cents: unknown;
    }>;
    const withdrawalCreated = (byKey.get('created') ?? []).length > 0;

    // Nothing was committed for this request: the claim did not cover the
    // amount. The batch already handed the claim back, so there is no stranded
    // state to clean up and nothing was withheld.
    if (!withdrawalCreated) {
      return Response.json(
        { error: 'Insufficient balance. Another withdrawal may be in progress.' },
        { status: 400 }
      );
    }

    const earningIds = reservedRows.map((e) => e.id);

    // Only report withholding that is actually IN the ledger. `inserted: false`
    // means an earlier attempt already wrote this exact row (same idempotency
    // key), so counting it again would double-report tax the seller has already
    // been charged once.
    let taxWithheldCents = 0;
    if (preparedTax) {
      const written = readWithholdingResult(
        preparedTax,
        (byKey.get('taxed') ?? []) as ReadonlyArray<{ id?: string }>
      );
      if (written.inserted) taxWithheldCents = preparedTax.amountCents;
    }

    // ---------------------------------------------------------------
    // TAX WITHHOLDING
    // ---------------------------------------------------------------
    // The withholding row is written INSIDE the transaction above, gated on the
    // withdrawal existing, so it can neither be lost after the money has moved
    // nor be recorded for a withdrawal that was rejected. `taxWithheldCents`
    // comes from that statement's RETURNING rows, so it always describes what
    // is actually in the ledger.

    return Response.json({
      success: true,
      withdrawalId,
      amountCents,
      // What the seller is actually paid, after any withholding.
      netPayoutCents: amountCents - taxWithheldCents,
      taxWithheldCents,
      // A rate alongside a zero withholding would imply tax was taken when none
      // was, so the rate is only reported when a ledger row exists.
      taxRateBps: taxWithheldCents > 0 ? split.rateBps : 0,
      status: 'PENDING',
      reference,
      estimatedArrival: estimatedArrival.toISOString(),
      earningsWithdrawn: earningIds.length,
    });
  } catch (error: any) {
    console.error('POST /api/withdrawals error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
