/**
 * Email-domain access policy — SINGLE SOURCE OF TRUTH for every enforcement
 * layer (defense in depth, ONE decision):
 *
 *   1. better-auth hooks      — sign-up / sign-in / user.create / session.create
 *   2. middleware             — access gate + public v1 API-key owner check
 *   3. requireAdmin / requireAdminPage / authenticateApiKey
 *   4. checkSignupAllowed     — signup-restriction semantics
 *
 * WHY THIS EXISTS (dual-authority defect, production-hardening audit 2026-09-24):
 * The admin setting (app_settings['signup_restrictions'] — "Restricted Signups")
 * and the environment allowlist (ALLOWED_EMAIL_DOMAINS) were previously enforced
 * by TWO different code paths. The admin UI could report OFF while middleware
 * kept enforcing the env allowlist — exactly the state divergence where the
 * frontend says one thing and the backend does another.
 *
 * RESOLUTION RULE (deterministic, fail-closed):
 *   - A row in app_settings['signup_restrictions'] is AUTHORITATIVE.
 *       signup_restricted = true  → only `allowed_email_domains` may pass
 *       signup_restricted = false → restriction DISABLED (any well-formed email)
 *   - No row (fresh install / pre-seed DB) → fall back to the ENVIRONMENT policy
 *     (ALLOWED_EMAIL_DOMAINS, default dealswiftautomation.com), reproducing the
 *     platform's historical behavior byte-for-byte.
 *   - Database error → the same environment fallback (fail closed to restricted,
 *     never fail open).
 *
 * ROLE GATING (MIN_ACCESS_ROLE) is a SEPARATE axis and is untouched here: a
 * domain-allowed MEMBER still routes to /pending-access until promoted. Turning
 * "Restricted Signups" OFF does not grant roles.
 *
 * The resolved policy is cached in-process for 10 s (single-flight), so a toggle
 * propagates to every runtime instance within 10 s without adding a DB round
 * trip to every request. `_resetEmailDomainPolicyCache()` exists for tests.
 *
 * Edge-safe: only imports sql (already used by middleware) + pure helpers.
 */
import sql from '@/app/api/utils/sql';
import { getAllowedEmailDomains, emailDomain } from '@/app/api/utils/access-control';

export interface EmailDomainPolicy {
  /** true → domain allowlist enforced; false → restriction disabled. */
  restricted: boolean;
  /** Lowercased allowlist; only meaningful when `restricted`. */
  domains: string[];
  /** Where the effective decision came from (for UI transparency + tests). */
  source: 'database' | 'environment';
}

const CACHE_TTL_MS = 10_000;

let cached: { policy: EmailDomainPolicy; expiresAt: number } | null = null;
let inflight: Promise<EmailDomainPolicy> | null = null;

/** Test hook: drop the in-process cache so the next read re-queries. */
export function _resetEmailDomainPolicyCache(): void {
  cached = null;
  inflight = null;
}

/** Historical behavior: env allowlist (or its default) — always restricted. */
function environmentPolicy(): EmailDomainPolicy {
  return { restricted: true, domains: getAllowedEmailDomains(), source: 'environment' };
}

/**
 * Resolve the effective policy. Cached 10 s, single-flight (concurrent requests
 * share one DB read). On any DB failure, falls back to the environment policy.
 */
export async function getEmailDomainPolicy(): Promise<EmailDomainPolicy> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.policy;
  if (inflight) return inflight;

  inflight = (async (): Promise<EmailDomainPolicy> => {
    try {
      const [row] = await sql`
        SELECT value FROM app_settings WHERE key = 'signup_restrictions' LIMIT 1
      `;
      const value = row?.value as
        | { signup_restricted?: unknown; allowed_email_domains?: unknown }
        | null
        | undefined;

      if (!value || typeof value !== 'object') return environmentPolicy();

      const restricted = value.signup_restricted === true;
      const domains = Array.isArray(value.allowed_email_domains)
        ? (value.allowed_email_domains as unknown[])
            .filter((d): d is string => typeof d === 'string')
            .map((d) => d.trim().toLowerCase())
            .filter(Boolean)
        : [];

      // Note: restricted=true with an EMPTY list is unwritable through the admin
      // API (validated), and if it ever appears in the DB it fails CLOSED —
      // nobody matches an empty allowlist.
      return { restricted, domains, source: 'database' };
    } catch (error) {
      console.error('[email-domain-policy] DB read failed; using environment policy:', error);
      return environmentPolicy();
    } finally {
      inflight = null;
    }
  })();

  const policy = await inflight;
  cached = { policy, expiresAt: Date.now() + CACHE_TTL_MS };
  return policy;
}

/**
 * Effective domain check used by EVERY enforcement layer.
 *  - restriction OFF      → any syntactically valid email passes (fail closed
 *                           on malformed input regardless of mode)
 *  - restriction ON       → domain must be in the effective allowlist
 */
export async function isEmailDomainAllowedEffective(email: unknown): Promise<boolean> {
  const domain = emailDomain(email);
  if (!domain) return false;

  const policy = await getEmailDomainPolicy();
  if (!policy.restricted) return true;
  return policy.domains.includes(domain);
}
