/**
 * Password-verification cost control — the guard that runs BEFORE scrypt.
 *
 * THE DEFECT THIS FIXES (measured 2026-10-03, production)
 * -------------------------------------------------------
 * 1. Password hashing is scrypt, not argon2. All 152 rows in `account.password`
 *    are `hex32:hex128` (exactly 161 chars) = salt + scrypt(N=16384, r=16, p=1,
 *    dkLen=64), which is @better-auth/utils' default. ZERO rows are `$argon2`,
 *    so the argon2 branch of `verifyCompatiblePassword()` is dead code and the
 *    long-standing "argon2 is too expensive here" note describes a cost that is
 *    not actually being paid.
 *
 * 2. That scrypt costs ~98ms (native node:crypto) / ~184ms (pure JS @noble) per
 *    verification, measured by scripts/_bench-password.mjs. The Workers **Free**
 *    plan allows ~10ms CPU per invocation. ONE login therefore costs roughly
 *    10x the entire budget, which is why sign-in intermittently returns
 *    Cloudflare's "Worker exceeded resource limits" 503.
 *
 * 3. better-auth's built-in limiter does not prevent this, because it is not
 *    atomic: it read-decide-writes around awaits, so N parallel requests each
 *    observe a stale count and all get admitted. Measured on the deployed
 *    Worker: a burst of 8 was admitted 5 times against a documented max of 3.
 *
 * THE FIX
 * -------
 * Do NOT weaken scrypt. Its cost IS its security property, and lowering N would
 * trade real security for a benchmark. Instead, make the limit atomic so that
 * only a bounded number of verifications can ever start inside one budget, using
 * the Postgres atomic primitive this repo ALREADY ships (`rateLimitByUser`:
 * `INSERT .. ON CONFLICT (identifier, action, window_start) DO UPDATE SET count
 * = count + 1 RETURNING count`, backed by the real unique index
 * `rate_limits_pkey`). That limiter is already proven concurrency-safe by
 * src/app/api/__tests__/security/rate-limit-bypass.pglite.test.ts (30 parallel
 * calls at limit 5 -> exactly 5 allowed).
 *
 * So this module does one thing: decide whether a verification may proceed.
 * `auth.ts` consults it inside its `before` hook, i.e. BEFORE any hashing runs.
 * The expensive work is bounded, the algorithm is untouched, and the check is
 * server-side and race-free.
 *
 * DESIGN NOTES
 * ------------
 * - Buckets on (IP, email). An attacker spraying one password across many
 *   accounts is only partly stopped by the email dimension, so the IP dimension
 *   is the real control; the email dimension additionally stops a distributed
 *   attack aimed at one victim.
 * - A failure to reach the database must NOT open the gate. It fails CLOSED:
 *   worst case a transient DB blip rejects a login, which the user retries,
 *   rather than admitting an unbounded hashing burst.
 * - No module-level mutable state: a Worker isolate is reused across requests,
 *   so an in-process counter would be both racy and per-isolate.
 */
import { rateLimitByUser } from '@/app/api/utils/rateLimit';

/** Actions, namespaced so they cannot collide with other buckets in the table. */
export const AUTH_GUARD_SIGN_IN = 'auth:signin:ip';
export const AUTH_GUARD_SIGN_IN_ACCOUNT = 'auth:signin:account';

/**
 * Ceilings. These bound how much CPU one invocation can spend, so they are
 * deliberately small. 3 per 10s matches better-auth's own documented intent for
 * /sign-in, so this does not tighten what a legitimate user experiences; it
 * makes that limit actually hold under concurrency.
 */
export const SIGN_IN_IP_LIMIT = 3;
export const SIGN_IN_IP_WINDOW_SECONDS = 10;

/** Per-account ceiling is looser: shared NAT and office egress share one IP. */
export const SIGN_IN_ACCOUNT_LIMIT = 10;
export interface AuthCostGuardResult {
  allowed: boolean;
  /** Which dimension refused, for logging. Never surfaced to the client verbatim. */
  scope?: 'ip' | 'account';
  retryAfterSeconds?: number;
  /** True when the limiter itself failed; the caller still fails closed. */
  limiterError?: boolean;
}

/**
 * Decide whether one sign-in attempt may proceed to password verification.
 *
 * Both dimensions must pass. Checks run cheapest-first and short-circuit so a
 * rejected IP never spends an account-bucket increment.
 */
export async function checkSignInCost(
  ip: string | null,
  email: string | null | undefined
): Promise<AuthCostGuardResult> {
  if (ip) {
    const ipLimit = await consume(AUTH_GUARD_SIGN_IN, ip, SIGN_IN_IP_LIMIT, SIGN_IN_IP_WINDOW_SECONDS);
    if (!ipLimit.ok) {
      return {
        allowed: false,
        scope: 'ip',
        retryAfterSeconds: ipLimit.retryAfterSeconds,
        limiterError: ipLimit.limiterError,
      };
    }
  }

  const account = normalizeEmail(email);
  if (account) {
    const acctLimit = await consume(
      AUTH_GUARD_SIGN_IN_ACCOUNT,
      account,
      SIGN_IN_ACCOUNT_LIMIT,
      SIGN_IN_ACCOUNT_WINDOW_SECONDS
    );
    if (!acctLimit.ok) {
      return {
        allowed: false,
        scope: 'account',
        retryAfterSeconds: acctLimit.retryAfterSeconds,
        limiterError: acctLimit.limiterError,
      };
    }
  }

  return { allowed: true };
}

type ConsumeOutcome = { ok: true } | { ok: false; retryAfterSeconds: number; limiterError: boolean };

async function consume(
  action: string,
  identifier: string,
  max: number,
  windowSeconds: number
): Promise<ConsumeOutcome> {
  try {
    const result = await rateLimitByUser(identifier, action, max, windowSeconds);
    if (result.allowed) return { ok: true };
    const retryAfterSeconds = Math.max(1, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000));
    return { ok: false, retryAfterSeconds, limiterError: false };
  } catch (err) {
    // FAIL CLOSED. The safe direction is to refuse an expensive computation we
    // cannot currently meter.
    console.error('[auth-cost-guard] limiter unavailable; failing closed', err);
    return { ok: false, retryAfterSeconds: windowSeconds, limiterError: true };
  }
}

/** Lower-cased, trimmed email; empty becomes null so it cannot key a bucket. */
function normalizeEmail(email: string | null | undefined): string | null {
  if (typeof email !== 'string') return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

export const SIGN_IN_ACCOUNT_WINDOW_SECONDS = 60;
