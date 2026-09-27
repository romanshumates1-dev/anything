/**
 * DELETE /api/bank-accounts/[id]
 *
 * Refuses to delete an account that a withdrawal is actively paying out, or
 * the only payout destination when the user still has an available balance —
 * otherwise a user could strand their own funds with no way to reach them.
 *
 * Returns 404 (not 403) for another tenant's account: no existence oracle.
 */
import sql from '@/app/api/utils/sql';
import { requireBankAccountUser } from '@/app/api/utils/bankAccounts';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireBankAccountUser();
  if (!a.ok) return a.response;

  const { id } = await params;

  try {
    const [account] = await sql`
      SELECT id, is_default FROM bank_accounts
      WHERE id = ${id}
        AND user_id = ${a.userId}
        AND organization_id = ${a.orgId}
      LIMIT 1
    `;
    if (!account) {
      return Response.json({ error: 'Bank account not found' }, { status: 404 });
    }

    const [pending] = await sql`
      SELECT COUNT(*)::int AS count FROM withdrawals
      WHERE user_id = ${a.userId}
        AND organization_id = ${a.orgId}
        AND payout_reference IS NOT NULL
        AND status IN ('PENDING', 'PROCESSING')
    `;
    if (Number(pending?.count ?? 0) > 0) {
      return Response.json(
        { error: 'Cannot remove a bank account while a withdrawal is in progress' },
        { status: 400 }
      );
    }

    if (account.is_default) {
      const [balance] = await sql`
        SELECT COALESCE(SUM(amount_cents), 0)::int AS available FROM earnings
        WHERE user_id = ${a.userId}
          AND organization_id = ${a.orgId}
          AND status = 'AVAILABLE'
      `;
      if (Number(balance?.available ?? 0) > 0) {
        return Response.json(
          { error: 'Cannot remove your only payout account while you have an available balance' },
          { status: 400 }
        );
      }
    }

    await sql`
      DELETE FROM bank_accounts
      WHERE id = ${id} AND user_id = ${a.userId} AND organization_id = ${a.orgId}
    `;

    // Promote the next most recent account so the user is never left with no
    // payout destination when they still have a balance.
    const [next] = await sql`
      SELECT id FROM bank_accounts
      WHERE user_id = ${a.userId} AND organization_id = ${a.orgId}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    if (next) {
      await sql`
        UPDATE bank_accounts SET is_default = true, updated_at = NOW()
        WHERE id = ${next.id} AND user_id = ${a.userId} AND organization_id = ${a.orgId}
      `;
    }

    await sql`
      INSERT INTO audit_logs (user_id, action, target_type, target_id, payload)
      VALUES (${a.userId}, 'bank_account_deleted', 'bank_account', ${id}, '{}')
    `;

    return Response.json({ success: true });
  } catch (error: any) {
    console.error('DELETE /api/bank-accounts/[id] error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
