/**
 * Admin Export API - CSV exports for organizations, payments, usage
 *
 * GET /api/admin/exports?type=organizations - export organizations as CSV
 * GET /api/admin/exports?type=payments - export payments as CSV
 * GET /api/admin/exports?type=usage - export usage ledger as CSV
 *
 * ADMIN-only via requireAdmin middleware.
 */
import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';

function formatCSV(rows: any[], columns: string[]): string {
  const header = columns.join(',');
  const data = rows.map((row) =>
    columns.map((col) => {
      const val = row[col];
      if (val === null || val === undefined) return '';
      const str = String(val);
      // Quote values containing commas, quotes, or newlines
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(',')
  );
  return [header, ...data].join('\n');
}

export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const { searchParams } = new URL(request.url);
  const exportType = searchParams.get('type') || 'organizations';

  try {
    let csv: string;
    let filename: string;

    switch (exportType) {
      case 'organizations': {
        const rows = await sql`
          SELECT
            o.id,
            o.name,
            o.slug,
            o."createdAt" as created_at,
            (SELECT COUNT(*)::int FROM "user" u WHERE u.organization_id = o.id) as member_count,
            os.status as subscription_status,
            os.trial_ends_at
          FROM organizations o
          LEFT JOIN organization_subscriptions os ON os.organization_id = o.id
          ORDER BY o."createdAt" DESC
          LIMIT 10000
        `;
        csv = formatCSV(rows, ['id', 'name', 'slug', 'created_at', 'member_count', 'subscription_status', 'trial_ends_at']);
        filename = `organizations-${new Date().toISOString().split('T')[0]}.csv`;
        break;
      }

      case 'payments': {
        const rows = await sql`
          SELECT
            pl.id,
            pl.contract_id,
            pl.amount_cents,
            pl.currency,
            pl.status,
            pl.created_at,
            pl.paid_at,
            pl.refunded_at,
            o.name as organization_name
          FROM payments_ledger pl
          JOIN contracts c ON c.id = pl.contract_id
          JOIN organizations o ON o.id = c.organization_id
          ORDER BY pl.created_at DESC
          LIMIT 10000
        `;
        csv = formatCSV(rows, ['id', 'contract_id', 'amount_cents', 'currency', 'status', 'created_at', 'paid_at', 'refunded_at', 'organization_name']);
        filename = `payments-${new Date().toISOString().split('T')[0]}.csv`;
        break;
      }

      case 'usage': {
        const rows = await sql`
          SELECT
            ul.id,
            ul.organization_id,
            o.name as organization_name,
            ul.metric_type,
            ul.amount,
            ul.unit,
            ul.recorded_at
          FROM usage_ledger ul
          LEFT JOIN organizations o ON o.id = ul.organization_id
          ORDER BY ul.recorded_at DESC
          LIMIT 10000
        `;
        csv = formatCSV(rows, ['id', 'organization_id', 'organization_name', 'metric_type', 'amount', 'unit', 'recorded_at']);
        filename = `usage-${new Date().toISOString().split('T')[0]}.csv`;
        break;
      }

      default:
        return Response.json({ error: 'Invalid export type. Use: organizations, payments, or usage' }, { status: 400 });
    }

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('GET /api/admin/exports error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}