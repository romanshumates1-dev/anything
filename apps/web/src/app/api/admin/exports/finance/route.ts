/**
 * Finance / tax export (Phase 4). Exports the REAL payments ledger.
 *
 * The prior version queried a `transactions` table that exists in no migration
 * (BREAKAGE_TABLE #29) — it 500'd on every call, which also meant its
 * admin_audit_log write never ran. Repointed to payments_ledger, joined
 * through contracts -> organizations -> owner user for the accountant-facing
 * columns, with proper CSV escaping (the old naive join broke on any comma).
 *
 * GET /api/admin/exports/finance?startDate=&endDate= -> CSV download. ADMIN-only.
 */
import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { adminAudit, clientIp } from '@/app/api/utils/adminAudit';

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  // Quote if it contains a comma, quote, or newline; double internal quotes.
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const url = new URL(request.url);
  const startDate = url.searchParams.get('startDate');
  const endDate = url.searchParams.get('endDate');

  try {
    // startDate/endDate are validated as bound params (NULL when absent) so a
    // single query covers all four range combinations without string-built SQL.
    const rows = await sql`
      SELECT
        p.id,
        p.created_at AS date,
        u.email AS owner_email,
        o.name AS organization,
        p.contract_id,
        p.amount_cents,
        p.currency,
        p.status,
        p.stripe_payment_intent_id,
        p.refunded_at
      FROM payments_ledger p
      LEFT JOIN contracts c ON c.id = p.contract_id
      LEFT JOIN organizations o ON o.id = c.organization_id
      LEFT JOIN "user" u ON u.id = o.owner_user_id
      WHERE (${startDate}::date IS NULL OR p.created_at::date >= ${startDate}::date)
        AND (${endDate}::date IS NULL OR p.created_at::date <= ${endDate}::date)
      ORDER BY p.created_at DESC
    `;

    // Fees are not tracked in payments_ledger, so net == gross; the column is
    // present for the accountant's template and left blank rather than faked.
    const header = ['date', 'owner_email', 'organization', 'contract_id', 'gross_amount', 'currency', 'fees', 'net', 'stripe_payment_intent_id', 'status', 'refunded_at'];
    const lines = (rows as any[]).map((t) => {
      const gross = (t.amount_cents ?? 0) / 100;
      return [
        t.date, t.owner_email, t.organization, t.contract_id,
        gross.toFixed(2), t.currency || 'usd', '', gross.toFixed(2),
        t.stripe_payment_intent_id, t.status, t.refunded_at,
      ].map(csvCell).join(',');
    });
    const csv = [header.join(','), ...lines].join('\n');

    await adminAudit({
      actorId: admin.userId,
      action: 'finance_export',
      targetType: 'payments_ledger',
      metadata: { rows: rows.length, startDate, endDate },
      ip: clientIp(request),
    });

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="finance-export.csv"',
      },
    });
  } catch (error) {
    console.error('GET /api/admin/exports/finance error', error);
    return Response.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to generate export' } }, { status: 500 });
  }
}
