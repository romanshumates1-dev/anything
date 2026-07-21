import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';

/**
 * Finance/tax export endpoint.
 * GET /api/admin/exports/finance - Download transactions as CSV
 */
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const url = new URL(request.url);
  const startDate = url.searchParams.get('startDate');
  const endDate = url.searchParams.get('endDate');

  try {
    let transactions;

    if (startDate && endDate) {
      transactions = await sql`
        SELECT 
          t.id,
          t."createdAt" as date,
          u.email,
          u.name,
          t.description,
          t.amount_cents,
          t.currency,
          t.stripe_fee_cents,
          t.status,
          t.stripe_payment_intent_id,
          t.stripe_refund_id
        FROM transactions t
        LEFT JOIN "user" u ON t.user_id = u.id
        WHERE DATE(t."createdAt") >= ${startDate} AND DATE(t."createdAt") <= ${endDate}
        ORDER BY t."createdAt" DESC
      `;
    } else if (startDate) {
      transactions = await sql`
        SELECT 
          t.id,
          t."createdAt" as date,
          u.email,
          u.name,
          t.description,
          t.amount_cents,
          t.currency,
          t.stripe_fee_cents,
          t.status,
          t.stripe_payment_intent_id,
          t.stripe_refund_id
        FROM transactions t
        LEFT JOIN "user" u ON t.user_id = u.id
        WHERE DATE(t."createdAt") >= ${startDate}
        ORDER BY t."createdAt" DESC
      `;
    } else if (endDate) {
      transactions = await sql`
        SELECT 
          t.id,
          t."createdAt" as date,
          u.email,
          u.name,
          t.description,
          t.amount_cents,
          t.currency,
          t.stripe_fee_cents,
          t.status,
          t.stripe_payment_intent_id,
          t.stripe_refund_id
        FROM transactions t
        LEFT JOIN "user" u ON t.user_id = u.id
        WHERE DATE(t."createdAt") <= ${endDate}
        ORDER BY t."createdAt" DESC
      `;
    } else {
      transactions = await sql`
        SELECT 
          t.id,
          t."createdAt" as date,
          u.email,
          u.name,
          t.description,
          t.amount_cents,
          t.currency,
          t.stripe_fee_cents,
          t.status,
          t.stripe_payment_intent_id,
          t.stripe_refund_id
        FROM transactions t
        LEFT JOIN "user" u ON t.user_id = u.id
        ORDER BY t."createdAt" DESC
      `;
    }

    // Generate CSV
    const header = 'date,user_email,description,gross_amount,fees,net,stripe_payment_id,stripe_refund_id,status';
    const rows = transactions.map((t: any) => 
      `${t.date},${t.email},${t.description || ''},${(t.amount_cents / 100).toFixed(2)},${(t.stripe_fee_cents || 0) / 100},${((t.amount_cents - (t.stripe_fee_cents || 0)) / 100).toFixed(2)},${t.stripe_payment_intent_id || ''},${t.stripe_refund_id || ''},${t.status}`
    );

    const csv = [header, ...rows].join('\n');

    // Log audit
    await sql`
      INSERT INTO admin_audit_log (id, actor_id, action, target_type, ip)
      VALUES ('audit_' || gen_random_uuid()::text, ${admin.userId}, 'finance_export', 'transactions', ${getClientIP(request)})
    `;

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="transactions-export.csv"',
      },
    });
  } catch (error) {
    console.error('GET /api/admin/exports/finance error', error);
    return Response.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to generate export' } }, { status: 500 });
  }
}

function getClientIP(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}