/**
 * Platform access policy — email-domain allowlist + role gate.
 *
 * Single source of truth for WHO may use the platform. Consumed by four
 * independent enforcement layers (defense in depth — no single bypass grants
 * access):
 *   1. Registration      — better-auth hooks in `@/lib/auth`
 *   2. Login / session   — better-auth hooks in `@/lib/auth`
 *   3. Server middleware — `src/middleware.ts` (every app page + API request)
 *   4. Public v1 API     — key issuance (`/api/settings/api-keys`) and key
 *                          validation (middleware + `/api/v1/auth/utils`)
 *
 * Config-driven so the rules loosen later WITHOUT code changes:
 *   ALLOWED_EMAIL_DOMAINS  comma-separated, default "dealswiftautomation.com"
 *   MIN_ACCESS_ROLE        ADMIN | MEMBER, default ADMIN (platform is
 *                          admin-only until the owner opens it up)
 *   SEED_ADMIN_EMAILS      comma-separated, default the owner; these emails
 *                          are granted ADMIN on user creation (idempotent)
 *
 * Env is read at CALL time (not module load) so a restarted server always
 * reflects the current .env. Edge-safe: no node: imports (middleware runs on
 * the edge runtime).
 */

export const ROLE_MEMBER = 'MEMBER';
export const ROLE_ADMIN = 'ADMIN';
export const KNOWN_ROLES = [ROLE_MEMBER, ROLE_ADMIN] as const;
export type Role = (typeof KNOWN_ROLES)[number];

const DEFAULT_ALLOWED_DOMAINS = ['dealswiftautomation.com'];
const DEFAULT_SEED_ADMIN_EMAILS = ['roman.shumate@dealswiftautomation.com'];

function parseCsv(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  const items = value
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  return items.length > 0 ? items : fallback;
}

export function getAllowedEmailDomains(): string[] {
  return parseCsv(process.env.ALLOWED_EMAIL_DOMAINS, DEFAULT_ALLOWED_DOMAINS);
}

/** Domain part of an email, lowercased — null when the shape isn't an email. */
export function emailDomain(email: unknown): string | null {
  if (typeof email !== 'string') return null;
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return null;
  return email.slice(at + 1).trim().toLowerCase();
}

export function isEmailDomainAllowed(email: unknown): boolean {
  const domain = emailDomain(email);
  if (!domain) return false;
  return getAllowedEmailDomains().includes(domain);
}

/** Rank for role comparison; unknown/missing roles rank below MEMBER (fail closed). */
export function roleRank(role: unknown): number {
  if (role === ROLE_ADMIN) return 2;
  if (role === ROLE_MEMBER) return 1;
  return 0;
}

/** Minimum role required to use the platform. Invalid config falls back to ADMIN (fail closed). */
export function getMinAccessRole(): Role {
  const configured = (process.env.MIN_ACCESS_ROLE || ROLE_ADMIN).trim().toUpperCase();
  return (KNOWN_ROLES as readonly string[]).includes(configured) ? (configured as Role) : ROLE_ADMIN;
}

export function hasRequiredRole(role: unknown): boolean {
  return roleRank(role) >= roleRank(getMinAccessRole());
}

export function isAdminRole(role: unknown): boolean {
  return role === ROLE_ADMIN;
}

export function getSeedAdminEmails(): string[] {
  return parseCsv(process.env.SEED_ADMIN_EMAILS, DEFAULT_SEED_ADMIN_EMAILS);
}

export function isSeedAdminEmail(email: unknown): boolean {
  if (typeof email !== 'string') return false;
  return getSeedAdminEmails().includes(email.trim().toLowerCase());
}
