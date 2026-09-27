/**
 * POST /api/bank-accounts/[id]/verify — micro-deposit verification.
 *
 * Two-step flow:
 *   1. { method: 'micro_deposit' }                  -> issue two deposits
 *   2. { verification_id, amounts: [a, b] }         -> confirm what landed
 *
 * WHY ATTEMPT-LIMITING IS LOAD-BEARING
 * The amounts are two values under $1.00, so the search space is tiny. Without
 * a hard cap an attacker could brute-force the pair. MAX_VERIFICATION_ATTEMPTS
 * locks the account after 5 failures.
 *
 * The expected amounts are stored ENCRYPTED and are never echoed back in the
 * initiation response — returning them would make verification pointless.
 */
import sql from '@/app/api/utils/sql';
import { encryptSensitive, decryptSensitive } from '@/app/api/utils/encryption';
import {
  requireBankAccountUser,
  generateMicroDepositAmounts,
  newVerificationId,
  MAX_VERIFICATION_ATTEMPTS,
  MICRO_DEPOSIT_EXPECTED_DAYS,
} from '@/app/api/utils/bankAccounts';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireBankAccountUser();
  if (!a.ok) return a.response;

  const { id } = await params;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const [account] = await sql`
      SELECT id, verified, verification_attempts, verification_amounts_encrypted
      FROM bank_accounts
      WHERE id = ${id}
        AND user_id = ${a.userId}
        AND organization_id = ${a.orgId}
      LIMIT 1
    `;
    // Anti-oracle: unknown id and other-tenant id are indistinguishable.
    if (!account) {
      return Response.json({ error: 'Bank account not found' }, { status: 404 });
    }

    if (account.verified) {
      return Response.json({ error: 'Bank account is already verified' }, { status: 400 });
    }

    if (Number(account.verification_attempts ?? 0) >= MAX_VERIFICATION_ATTEMPTS) {
      return Response.json(
        { error: 'Too many failed verification attempts. Please contact support.' },
        { status: 429 }
      );
    }

    // ---- Step 2: confirm the amounts ----
    if (Array.isArray(body?.amounts)) {
      const submitted = body.amounts.map((n: any) => Number(n));
      const expectedRaw = account.verification_amounts_encrypted;
      if (!expectedRaw) {
        return Response.json(
          { error: 'No verification in progress. Start verification first.' },
          { status: 400 }
        );
      }

      let expected: number[] = [];
      try {
        expected = JSON.parse(decryptSensitive(expectedRaw));
      } catch {
        return Response.json({ error: 'Verification state is unreadable' }, { status: 400 });
      }

      const submittedSorted = [...submitted].sort((x, y) => x - y);
      const expectedSorted = [...expected].sort((x, y) => x - y);
      const matches =
        submittedSorted.length === expectedSorted.length &&
        submittedSorted.every((v, i) => v === expectedSorted[i]);

      if (!matches) {
        await sql`
          UPDATE bank_accounts
          SET verification_attempts = verification_attempts + 1, updated_at = NOW()
          WHERE id = ${id} AND user_id = ${a.userId} AND organization_id = ${a.orgId}
        `;
        await sql`
          INSERT INTO audit_logs (user_id, action, target_type, target_id, payload)
          VALUES (${a.userId}, 'bank_account_verify_failed', 'bank_account', ${id}, '{}')
        `;
        return Response.json({ error: 'Verification amounts do not match' }, { status: 400 });
      }

      const [verifiedRow] = await sql`
        UPDATE bank_accounts
        SET verified = true, verified_at = NOW(),
            verification_amounts_encrypted = NULL, updated_at = NOW()
        WHERE id = ${id} AND user_id = ${a.userId} AND organization_id = ${a.orgId}
        RETURNING id, bank_name, account_type, last_four, verified, verified_at,
                  is_default, created_at, updated_at
      `;
      await sql`
        INSERT INTO audit_logs (user_id, action, target_type, target_id, payload)
        VALUES (${a.userId}, 'bank_account_verified', 'bank_account', ${id}, '{}')
      `;
      return Response.json({ verified: true, account: verifiedRow });
    }

    // ---- Step 1: issue the deposits ----
    const amounts = generateMicroDepositAmounts();
    const verificationId = newVerificationId();

    // SECURITY: `verification_attempts` is deliberately NOT reset here.
    //
    // It used to be set to 0 in this statement. Because the cap check above
    // reads the same column, the sequence
    //     initiate -> wrong guess -> initiate -> wrong guess -> ...
    // reset the counter on every round, so MAX_VERIFICATION_ATTEMPTS was
    // unreachable in practice and the two-amount space (1..99 x 1..99 =
    // 9,801 pairs) could be brute-forced at will. Issuing fresh deposits must
    // not hand the guesser a fresh allowance of tries.
    //
    // Consequence: five wrong guesses lock the account out of self-service
    // verification for good. That is the intended trade — recovery is to delete
    // the bank account and re-add it, or an operator resets the column. A
    // time-windowed cap would be friendlier, but it needs a separate, trusted
    // timestamp; reusing verification_started_at would reintroduce a bypass,
    // because initiate is exactly what moves that clock.
    await sql`
      UPDATE bank_accounts
      SET verification_id = ${verificationId},
          verification_amounts_encrypted = ${encryptSensitive(JSON.stringify(amounts))},
          verification_started_at = NOW(),
          updated_at = NOW()
      WHERE id = ${id} AND user_id = ${a.userId} AND organization_id = ${a.orgId}
    `;

    await sql`
      INSERT INTO audit_logs (user_id, action, target_type, target_id, payload)
      VALUES (${a.userId}, 'bank_account_verification_started', 'bank_account', ${id}, '{}')
    `;

    return Response.json({
      verification_id: verificationId,
      status: 'pending',
      expected_days: MICRO_DEPOSIT_EXPECTED_DAYS,
    });
  } catch (error: any) {
    console.error('POST /api/bank-accounts/[id]/verify error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
