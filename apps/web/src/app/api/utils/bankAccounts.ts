/**
 * Bank account helpers — validation, at-rest encryption, and tenant-safe reads.
 *
 * WHY THIS EXISTS
 * ---------------
 * /api/withdrawals POST hard-requires a default + verified bank_accounts row
 * (see src/app/api/withdrawals/route.ts:222-243). Until these helpers and the
 * bank-accounts routes existed, sellers could accrue earnings but could never
 * withdraw a cent: the table existed, the query existed, nothing could write to
 * it.
 *
 * DATA AT REST
 * ------------
 * The 073 schema only had `last_four`, which is enough to *display* an account
 * but not enough to actually pay one — and a schema with no place to put the
 * numbers invites a future engineer to add plaintext columns. So:
 *   - routing/account numbers are ALWAYS encrypted with AES-256-GCM
 *     (utils/encryption.ts) before they reach the DB. Never logged, never
 *     returned by any route.
 *   - duplicate detection uses a keyed HMAC fingerprint, so we never need to
 *     decrypt-and-compare (which would also be a timing side channel).
 */
import { createHmac, randomBytes, randomInt } from 'crypto';
import { encryptSensitive } from './encryption';
import { auth } from '@/lib/auth';
import { getOrganization } from '@/lib/organization-context';
import { headers } from 'next/headers';

/** Public shape. Encrypted columns are deliberately absent. */
export interface PublicBankAccount {
  id: string;
  bank_name: string;
  account_type: string;
  last_four: string;
  verified: boolean;
  verified_at: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Session + organization guard shared by every bank-accounts route.
 *
 * Deliberately lives here rather than being imported from `route.ts`: the
 * per-id routes would otherwise have to reach back into a sibling route file,
 * which couples route entrypoints to one another (and resolves at the wrong
 * depth from nested segments).
 */
export async function requireBankAccountUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { ok: false as const, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const organization = await getOrganization();
  if (!organization) {
    return {
      ok: false as const,
      response: Response.json({ error: 'No organization found' }, { status: 403 }),
    };
  }
  return { ok: true as const, userId: session.user.id, orgId: organization.id };
}


/**
 * Strip every secret column. Routes MUST return the result of this, never the
 * raw row — the raw row contains ciphertext that should not leave the server.
 */
export function toPublicBankAccount(row: any): PublicBankAccount {
  return {
    id: row.id,
    bank_name: row.bank_name,
    account_type: row.account_type,
    last_four: row.last_four,
    verified: Boolean(row.verified),
    verified_at: row.verified_at ?? null,
    is_default: Boolean(row.is_default),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * ABA routing number checksum (3-7-1 weighting).
 * 021000021 => 0*3+2*7+1*1+0*3+0*7+0*1+0*3+2*7+1*1 = 30, 30 % 10 === 0.
 */
export function isValidRoutingNumber(routing: string): boolean {
  if (!/^\d{9}$/.test(routing)) return false;
  const d = routing.split('').map(Number);
  const sum = 3 * d[0] + 7 * d[1] + d[2] + 3 * d[3] + 7 * d[4] + d[5] + 3 * d[6] + 7 * d[7] + d[8];
  return sum % 10 === 0;
}

/** US checking/savings account numbers are 4-17 digits. */
export function isValidAccountNumber(account: string): boolean {
  return /^\d{4,17}$/.test(account);
}

function fingerprintKey(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is required for bank account storage');
  }
  return key;
}

/**
 * Keyed fingerprint of routing+account. Deterministic (so we can look up a
 * duplicate) but not reversible without ENCRYPTION_KEY. Scoped per user so one
 * user cannot probe whether another user has banked a given account.
 */
export function accountFingerprint(userId: string, routing: string, account: string): string {
  return createHmac('sha256', fingerprintKey())
    .update(`${userId}:${routing}:${account}`)
    .digest('hex');
}

/**
 * Encrypt the account numbers for storage. Both are returned so the caller
 * cannot accidentally write only one of them.
 */
export function encryptAccountNumbers(routing: string, account: string) {
  return {
    routing_number_encrypted: encryptSensitive(routing),
    account_number_encrypted: encryptSensitive(account),
  };
}

/**
 * Generate two micro-deposit amounts in cents, each $0.01-$0.99 and distinct,
 * so two amounts are required (matching real ACH micro-deposit practice).
 */
export function generateMicroDepositAmounts(): [number, number] {
  const a = randomInt(1, 100);
  let b = randomInt(1, 100);
  let guard = 0;
  while (b === a && guard++ < 10) b = randomInt(1, 100);
  return [a, b];
}

/** Max failed micro-deposit attempts before the account is locked. */
export const MAX_VERIFICATION_ATTEMPTS = 5;

/** Days a user should expect micro-deposits to land. */
export const MICRO_DEPOSIT_EXPECTED_DAYS = 2;

export function newVerificationId(): string {
  return `ver_${randomBytes(12).toString('hex')}`;
}
