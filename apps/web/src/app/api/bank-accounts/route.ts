/**
 * Bank Accounts API — list and add.
 *
 * These routes are the missing half of the seller payout path. The
 * `bank_accounts` table has existed since 073_earnings_escrow.sql and
 * /api/withdrawals POST already requires a default + verified row, but until
 * now nothing could write to that table: sellers accrued earnings and had no
 * path to a payout.
 *
 * SECURITY
 * --------
 * - routing/account numbers are AES-256-GCM encrypted before they reach the
 *   DB and are never returned, logged, or echoed back (see utils/bankAccounts).
 * - duplicate detection uses a keyed HMAC fingerprint (no plaintext compare,
 *   no decrypt-and-compare timing channel).
 * - the default-account flag is decided server-side; a caller cannot promote
 *   or demote anyone else's account.
 */
import sql from '@/app/api/utils/sql';
import { randomUUID } from 'crypto';
import {
  toPublicBankAccount,
  isValidRoutingNumber,
  isValidAccountNumber,
  accountFingerprint,
  encryptAccountNumbers,
  requireBankAccountUser,
} from '@/app/api/utils/bankAccounts';

const MAX_ACCOUNTS_PER_USER = 5;

/**
 * GET /api/bank-accounts
 * List the current user's bank accounts. Only display-safe fields are returned.
 */
export async function GET() {
  const a = await requireBankAccountUser();
  if (!a.ok) return a.response;

  try {
    const rows = await sql`
      SELECT id, bank_name, account_type, last_four, verified, verified_at,
             is_default, created_at, updated_at
      FROM bank_accounts
      WHERE user_id = ${a.userId}
        AND organization_id = ${a.orgId}
      ORDER BY is_default DESC, created_at DESC
    `;
    return Response.json({ accounts: rows.map(toPublicBankAccount) });
  } catch (error: any) {
    console.error('GET /api/bank-accounts error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * POST /api/bank-accounts
 * Add a bank account. Numbers are encrypted at rest; the response carries only
 * display-safe fields.
 */
export async function POST(request: Request) {
  const a = await requireBankAccountUser();
  if (!a.ok) return a.response;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const bankName = typeof body?.bank_name === 'string' ? body.bank_name.trim() : '';
  const routingRaw = typeof body?.routing_number === 'string' ? body.routing_number.trim() : '';
  const accountRaw = typeof body?.account_number === 'string' ? body.account_number.trim() : '';
  const accountType = body?.account_type ?? 'checking';

  if (!bankName || bankName.length > 120) {
    return Response.json({ error: 'bank_name is required' }, { status: 400 });
  }
  if (!routingRaw) {
    return Response.json({ error: 'routing_number is required' }, { status: 400 });
  }
  if (!accountRaw) {
    return Response.json({ error: 'account_number is required' }, { status: 400 });
  }
  if (accountType !== 'checking' && accountType !== 'savings') {
    return Response.json({ error: 'account_type must be checking or savings' }, { status: 400 });
  }

  // Tolerate the separators a real bank app shows the user (spaces, dashes,
  // dots) but nothing else. A blanket /\D/g strip would silently turn
  // "12-34-5678" into a valid 12345678, so junk input would be accepted.
  const routingNumber = routingRaw.replace(/[ .-]/g, '');
  const accountNumber = accountRaw.replace(/[ .-]/g, '');

  if (!isValidRoutingNumber(routingNumber)) {
    return Response.json({ error: 'routing_number is not a valid ABA routing number' }, { status: 400 });
  }
  if (!isValidAccountNumber(accountNumber)) {
    return Response.json({ error: 'account_number must be 4-17 digits' }, { status: 400 });
  }

  try {
    const fingerprint = accountFingerprint(a.userId, routingNumber, accountNumber);

    // 1. Duplicate probe — keyed fingerprint, scoped to this user.
    const [existing] = await sql`
      SELECT id FROM bank_accounts
      WHERE user_id = ${a.userId}
        AND organization_id = ${a.orgId}
        AND account_fingerprint = ${fingerprint}
      LIMIT 1
    `;
    if (existing) {
      return Response.json({ error: 'This bank account is already connected' }, { status: 409 });
    }

    // 2. Cap the number of accounts per user.
    const [countRow] = await sql`
      SELECT COUNT(*)::int AS count FROM bank_accounts
      WHERE user_id = ${a.userId} AND organization_id = ${a.orgId}
    `;
    if (Number(countRow?.count ?? 0) >= MAX_ACCOUNTS_PER_USER) {
      return Response.json(
        { error: `You can connect at most ${MAX_ACCOUNTS_PER_USER} bank accounts` },
        { status: 400 }
      );
    }

    // 3. First account becomes the default; never demote an existing default.
    const [currentDefault] = await sql`
      SELECT id FROM bank_accounts
      WHERE user_id = ${a.userId}
        AND organization_id = ${a.orgId}
        AND is_default = true
      LIMIT 1
    `;
    const makeDefault = !currentDefault;

    const { routing_number_encrypted, account_number_encrypted } = encryptAccountNumbers(
      routingNumber,
      accountNumber
    );

    const [created] = await sql`
      INSERT INTO bank_accounts (
        id, user_id, organization_id, bank_name, account_type, last_four,
        verified, is_default, routing_number_encrypted, account_number_encrypted,
        account_fingerprint, verification_attempts
      )
      VALUES (
        ${`ba_${randomUUID().replace(/-/g, '')}`}, ${a.userId}, ${a.orgId},
        ${bankName}, ${accountType}, ${accountNumber.slice(-4)},
        false, ${makeDefault}, ${routing_number_encrypted}, ${account_number_encrypted},
        ${fingerprint}, 0
      )
      RETURNING id, bank_name, account_type, last_four, verified, verified_at,
                is_default, created_at, updated_at
    `;

    await sql`
      INSERT INTO audit_logs (user_id, action, target_type, target_id, payload)
      VALUES (
        ${a.userId}, 'bank_account_added', 'bank_account', ${created.id},
        ${JSON.stringify({
          bank_name: bankName,
          account_type: accountType,
          last_four: accountNumber.slice(-4),
        })}
      )
    `;

    return Response.json({ account: toPublicBankAccount(created) }, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/bank-accounts error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
