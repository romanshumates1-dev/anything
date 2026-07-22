/**
 * User ban / suspend status helpers (Phase 4). A user is denied access when
 * banned=true OR suspended_until is in the future. These are checked at every
 * auth layer so revocation is immediate and cannot be bypassed by a cached
 * session or a still-valid API key.
 */
export interface BanState {
  banned: boolean;
  suspended_until: string | Date | null;
}

export function isAccessDenied(u: BanState | null | undefined): boolean {
  if (!u) return false;
  if (u.banned) return true;
  if (u.suspended_until) {
    const until = new Date(u.suspended_until).getTime();
    if (!Number.isNaN(until) && until > Date.now()) return true;
  }
  return false;
}
