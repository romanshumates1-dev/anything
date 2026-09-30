import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { getOrganization } from '@/lib/organization-context';
import { headers } from 'next/headers';
import { randomUUID } from 'crypto';

/**
 * GET /api/earnings
 * List user earnings with balance summary.
 *
 * Date filtering: `from`/`to` (ISO dates) constrain the returned ROWS only.
 * The summary always describes the FULL ledger (it answers "how much can I
 * withdraw right now"), so a filtered view can never shrink the balance and
 * mislead the payout action. The response echoes `filters.from/to` so the UI
 * can prove the totals came from the server for that range.
 */
export async function GET(request?: Request) {
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

    // Server-side date filter: rows only, never the withdrawable summary.
    // Invalid dates fall back to unbounded on that side (a mistyped filter
    // shows everything, never an empty list that looks like missing money).
    const MAX_RANGE_DAYS = 366 * 3; // 3 years - bounds the aggregate cost.
    const url = request ? new URL(request.url) : null;
    const parseDate = (value: string | null): Date | null => {
      if (!value) return null;
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d;
    };
    const from = parseDate(url?.searchParams.get('from') ?? null);
    const to = parseDate(url?.searchParams.get('to') ?? null);
    if (from && to && from > to) {
      return Response.json({ error: '`from` must not be after `to`' }, { status: 400 });
    }
    if (from && to && (to.getTime() - from.getTime()) / 86_400_000 > MAX_RANGE_DAYS) {
      return Response.json(
        { error: `Date range must not exceed ${MAX_RANGE_DAYS} days` },
        { status: 400 }
      );
    }

    // Get earnings for this user (filtered to the requested window)
    const earnings = await sql`
      SELECT
        e.id,
        e.contract_id,
        e.amount_cents,
        e.status,
        e.description,
        e.available_at,
        e.deal_closed_at,
        e.refunded_at,
        e.refund_reason,
        e.withdrawal_id,
        e.created_at,
        c.metadata as contract_metadata
      FROM earnings e
      LEFT JOIN contracts c ON c.id = e.contract_id
      WHERE e.user_id = ${userId}
        AND e.organization_id = ${orgId}
        AND (${from}::timestamptz IS NULL OR e.created_at >= ${from})
        AND (${to}::timestamptz IS NULL OR e.created_at <= ${to})
      ORDER BY e.created_at DESC
      LIMIT 500
    `;

    // Range-scoped ledger totals: computed in SQL from the SAME rows, so the
    // totals and the list can never disagree (no presentation-layer math).
    const [rangeTotals] = await sql`
      SELECT
        COALESCE(SUM(e.amount_cents), 0) as gross_cents,
        COALESCE(SUM(CASE WHEN e.status = 'PENDING' THEN e.amount_cents ELSE 0 END), 0) as pending_cents,
        COALESCE(SUM(CASE WHEN e.status = 'AVAILABLE' THEN e.amount_cents ELSE 0 END), 0) as available_cents,
        COALESCE(SUM(CASE WHEN e.status = 'WITHDRAWN' THEN e.amount_cents ELSE 0 END), 0) as withdrawn_cents,
        COALESCE(SUM(CASE WHEN e.status = 'REFUNDED' THEN e.amount_cents ELSE 0 END), 0) as refunded_cents,
        COUNT(*) as count
      FROM earnings e
      WHERE e.user_id = ${userId}
        AND e.organization_id = ${orgId}
        AND (${from}::timestamptz IS NULL OR e.created_at >= ${from})
        AND (${to}::timestamptz IS NULL OR e.created_at <= ${to})
    `;

    // Calculate balance summary (FULL ledger: the withdrawable truth)
    const summary = await sql`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'PENDING' THEN amount_cents ELSE 0 END), 0) as pending,
        COALESCE(SUM(CASE WHEN status = 'AVAILABLE' THEN amount_cents ELSE 0 END), 0) as available,
        COALESCE(SUM(CASE WHEN status = 'WITHDRAWN' THEN amount_cents ELSE 0 END), 0) as withdrawn,
        COALESCE(SUM(CASE WHEN status = 'REFUNDED' THEN amount_cents ELSE 0 END), 0) as refunded,
        COALESCE(SUM(CASE WHEN status IN ('AVAILABLE', 'WITHDRAWN') THEN amount_cents ELSE 0 END), 0) as total_earned
      FROM earnings
      WHERE user_id = ${userId}
        AND organization_id = ${orgId}
    `;

    // Get payout settings
    const [settings] = await sql`
      SELECT * FROM payout_settings
      WHERE user_id = ${userId}
      LIMIT 1
    `;

    // Get default bank account
    const [bankAccount] = await sql`
      SELECT id, bank_name, account_type, last_four, verified, verified_at
      FROM bank_accounts
      WHERE user_id = ${userId}
        AND is_default = true
      LIMIT 1
    `;

    return Response.json({
      earnings,
      summary: summary[0] || {
        pending: 0,
        available: 0,
        withdrawn: 0,
        refunded: 0,
        total_earned: 0,
      },
      rangeTotals: rangeTotals || {
        gross_cents: 0,
        pending_cents: 0,
        available_cents: 0,
        withdrawn_cents: 0,
        refunded_cents: 0,
        count: 0,
      },
      filters: {
        from: from ? from.toISOString() : null,
        to: to ? to.toISOString() : null,
      },
      settings: settings || {
        default_hold_days: 14,
        auto_payout_threshold_cents: 0,
        notify_on_available: true,
        notify_on_payout: true,
      },
      bankAccount: bankAccount || null,
      minimumPayout: 10000, // $100 minimum
    });
  } catch (error: any) {
    console.error('GET /api/earnings error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * POST /api/earnings
 * Create an earning when a deal closes.
 * Called internally when a contract is marked as CLOSED.
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const organization = await getOrganization();
    if (!organization) {
      return Response.json({ error: 'No organization found' }, { status: 403 });
    }

    const body = await request.json();
    const { contractId, amountCents, description, holdDays } = body;

    if (!contractId || !amountCents || amountCents <= 0) {
      return Response.json(
        { error: 'contractId and positive amountCents are required' },
        { status: 400 }
      );
    }

    const userId = session.user.id;
    const orgId = organization.id;

    // Verify contract belongs to this org
    const [contract] = await sql`
      SELECT id, status, assignment_fee_cents
      FROM contracts
      WHERE id = ${contractId}
        AND organization_id = ${orgId}
      LIMIT 1
    `;

    if (!contract) {
      return Response.json({ error: 'Contract not found' }, { status: 404 });
    }

    // Check for existing earning for this contract
    const [existing] = await sql`
      SELECT id FROM earnings
      WHERE contract_id = ${contractId}
      LIMIT 1
    `;

    if (existing) {
      return Response.json(
        { error: 'Earning already exists for this contract' },
        { status: 409 }
      );
    }

    // Get user's payout settings for hold period
    const [settings] = await sql`
      SELECT default_hold_days FROM payout_settings
      WHERE user_id = ${userId}
      LIMIT 1
    `;

    const effectiveHoldDays = holdDays || settings?.default_hold_days || 14;
    const now = new Date();
    const availableAt = new Date(now.getTime() + effectiveHoldDays * 24 * 60 * 60 * 1000);

    const earningId = `earn_${randomUUID()}`;

    await sql`
      INSERT INTO earnings (
        id, user_id, organization_id, contract_id, amount_cents,
        status, description, available_at, deal_closed_at
      )
      VALUES (
        ${earningId}, ${userId}, ${orgId}, ${contractId}, ${amountCents},
        'PENDING', ${description || 'Deal assignment fee'},
        ${availableAt}, ${now}
      )
    `;

    return Response.json({
      success: true,
      earningId,
      amountCents,
      status: 'PENDING',
      availableAt: availableAt.toISOString(),
      holdDays: effectiveHoldDays,
    });
  } catch (error: any) {
    console.error('POST /api/earnings error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
