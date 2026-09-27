/**
 * POST /api/bank-accounts/[id]/default
 *
 * Promote one of the caller's own accounts to be the payout default.
 *
 * Returns 404 — never 403 — when the id does not belong to the caller. A 403
 * would confirm the id exists in another tenant and hand an attacker a free
 * existence oracle over the whole account-id space.
 */
import sql from '@/app/api/utils/sql';
import { toPublicBankAccount, requireBankAccountUser } from '@/app/api/utils/bankAccounts';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireBankAccountUser();
  if (!a.ok) return a.response;

  const { id } = await params;

  try {
    const [account] = await sql`
      SELECT id FROM bank_accounts
      WHERE id = ${id}
        AND user_id = ${a.userId}
        AND organization_id = ${a.orgId}
      LIMIT 1
    `;
    if (!account) {
      return Response.json({ error: 'Bank account not found' }, { status: 404 });
    }

    // Clear the previous default first, then promote. Both statements are
    // scoped to this user+org so a race can never clear someone else's flag.
    await sql`
      UPDATE bank_accounts SET is_default = false, updated_at = NOW()
      WHERE user_id = ${a.userId} AND organization_id = ${a.orgId} AND is_default = true
    `;
    const [updated] = await sql`
      UPDATE bank_accounts
      SET is_default = true, updated_at = NOW()
      WHERE id = ${id} AND user_id = ${a.userId} AND organization_id = ${a.orgId}
      RETURNING id, bank_name, account_type, last_four, verified, verified_at,
                is_default, created_at, updated_at
    `;
    if (!updated) {
      // Ownership was verified moments ago, so this means the row vanished or
      // changed tenant under us. Fail closed rather than returning a phantom.
      return Response.json({ error: 'Bank account not found' }, { status: 404 });
    }

    await sql`
      INSERT INTO audit_logs (user_id, action, target_type, target_id, payload)
      VALUES (${a.userId}, 'bank_account_default_set', 'bank_account', ${id}, '{}')
    `;

    return Response.json({ account: toPublicBankAccount(updated) });
  } catch (error: any) {
    console.error('POST /api/bank-accounts/[id]/default error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
