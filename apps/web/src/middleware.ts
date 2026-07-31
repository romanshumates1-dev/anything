import { NextRequest, NextResponse } from 'next/server';
import sql from '@/app/api/utils/sql';
import {
  hasRequiredRole,
  isEmailDomainAllowed,
} from '@/app/api/utils/access-control';
import { REQUIRED_ACCEPTANCE_VERSIONS, ACCEPTANCE_DOC_TYPES } from '@/lib/legal-versions';
import { isAccessDenied } from '@/lib/user-status';

/**
 * Two independent server-side gates run here, on the edge, before any route
 * handler:
 *
 * 1. Per-KEY rate limiter + key-owner authorization for the public v1 API
 *    (/api/v1/*). Domain-lock layer 4: a key whose owning user is missing,
 *    out-of-domain, or below MIN_ACCESS_ROLE is rejected even if the key
 *    itself is valid.
 *
 * 2. Access gate for every authenticated app page + API (domain-lock layer 3
 *    + the role gate): a request carrying a session whose user's email domain
 *    is not allowlisted gets 403 / redirected to /access-restricted; an
 *    allowed-domain user below MIN_ACCESS_ROLE gets 403 / /pending-access.
 *    Requests WITHOUT a session pass through untouched — every data route
 *    still enforces its own session check (this layer only ever tightens
 *    access, so a middleware gap can never widen it).
 *
 * Rate-limiter ghost-feature note (verification sprint 2026-07): the prior
 * implementation was inert dead code — never wired as Next middleware, keyed
 * per-IP (`pathname:ip`), and set X-RateLimit-* headers on a response object
 * it never returned. It has been rebuilt as a real, wired, per-KEY
 * sliding-window limiter. SaaS customers share NATs, so per-IP buckets would
 * let one tenant starve another; the bucket MUST be the API key.
 */

const WINDOW_MS = 60 * 1000;
const DEFAULT_LIMIT = 120;

// In-memory sliding-window log: hashed API key -> ascending request timestamps
// within the current window. Module-level, so it survives across requests in a
// single runtime instance (the same lifetime model as the original map).
const buckets = new Map<string, number[]>();

/** Test-only: clear all rate-limit state between cases. */
export function _resetRateLimitState(): void {
  buckets.clear();
}

async function sha256Hex(input: string): Promise<string> {
  // Web Crypto so this works in both the edge and node runtimes (node:crypto
  // is unavailable on the edge, where middleware runs by default).
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface SlidingWindowResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: number; // epoch ms when the window frees up
  retryAfter: number; // seconds
}

/**
 * Pure sliding-window check. Records the hit only when allowed, so a blocked
 * caller cannot indefinitely push its own reset forward. Exported for direct
 * unit testing with a controlled `now`.
 */
export function slidingWindow(bucketId: string, limit: number, now: number): SlidingWindowResult {
  const windowStart = now - WINDOW_MS;
  const hits = (buckets.get(bucketId) ?? []).filter((t) => t > windowStart);

  if (hits.length >= limit) {
    buckets.set(bucketId, hits);
    const resetAt = hits[0] + WINDOW_MS;
    return {
      allowed: false,
      remaining: 0,
      limit,
      resetAt,
      retryAfter: Math.max(1, Math.ceil((resetAt - now) / 1000)),
    };
  }

  hits.push(now);
  buckets.set(bucketId, hits);
  return {
    allowed: true,
    remaining: Math.max(0, limit - hits.length),
    limit,
    resetAt: hits[0] + WINDOW_MS,
    retryAfter: 0,
  };
}

/**
 * Enforce per-KEY rate limiting for /api/v1/* requests. Returns:
 *  - the passthrough response (`NextResponse.next()`) carrying X-RateLimit-*
 *    headers when the request is allowed,
 *  - a 401 when the key is missing/invalid/revoked (checked BEFORE consuming
 *    any rate-limit budget, so anonymous traffic can't burn a bucket),
 *  - a 429 with Retry-After + X-RateLimit-* when the key is over its limit.
 * Non-v1 paths pass through untouched (no auth, no budget, no DB call).
 */
export async function enforceRateLimit(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  // The Swagger UI docs page lives under /api/v1/docs but is a public HTML page,
  // not a keyed API endpoint — never rate-limit or 401 it.
  if (!pathname.startsWith('/api/v1/') || pathname === '/api/v1/docs') {
    return NextResponse.next();
  }

  const authHeader = req.headers.get('authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Missing API key' }, { status: 401 });
  }
  const key = authHeader.slice(7).trim();
  if (!key) {
    return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
  }

  const keyHash = await sha256Hex(key);
  const prefix = key.split('_').slice(0, 2).join('_') + '_';

  const [record] = await sql`
    SELECT k.id, k.revoked, k.rate_limit_per_min, u.email AS owner_email, u.role AS owner_role,
           u.banned AS owner_banned, u.suspended_until AS owner_suspended_until
    FROM api_keys k
    LEFT JOIN "user" u ON u.id = k.created_by
    WHERE k.key_hash = ${keyHash} AND k.prefix = ${prefix}
    LIMIT 1
  `;

  if (!record || record.revoked) {
    return NextResponse.json({ error: 'Invalid or revoked API key' }, { status: 401 });
  }

  // Domain-lock layer 4 + ban gate: keys are only VALID for allowed-domain,
  // approved-role, NON-banned users. Fail closed on ownerless keys (created_by
  // no longer resolves) — reissue under a live admin account instead. Banning
  // a user thus rejects their API tokens too (Phase 4 DoD).
  if (
    !record.owner_email ||
    !isEmailDomainAllowed(record.owner_email) ||
    !hasRequiredRole(record.owner_role) ||
    isAccessDenied({ banned: record.owner_banned, suspended_until: record.owner_suspended_until })
  ) {
    return NextResponse.json({ error: 'API key owner is not authorized' }, { status: 403 });
  }

  const limit = Number(record.rate_limit_per_min) || DEFAULT_LIMIT;
  const result = slidingWindow(keyHash, limit, Date.now());

  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
  };

  if (!result.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', retryAfter: result.retryAfter },
      { status: 429, headers: { ...headers, 'Retry-After': String(result.retryAfter) } }
    );
  }

  const res = NextResponse.next();
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  return res;
}

/**
 * Paths the access gate must never touch:
 *  - better-auth's own endpoints (sign-in/out/up live there; the auth hooks in
 *    src/lib/auth.ts enforce the domain lock on them independently),
 *  - secret/signature-authenticated machine endpoints (Twilio webhook, job
 *    runner, cron, health/readiness),
 *  - the public OpenAPI doc + Swagger UI.
 * /api/v1/* is handled by the key path above, not the session path.
 */
const ACCESS_GATE_EXEMPT_PREFIXES = [
  '/api/auth',
  '/api/sms/inbound',
  '/api/sms/status',
  '/api/jobs/process',
  '/api/system',
  '/api/openapi',
  // Recording legal acceptance is a PRE-access action: a brand-new signup is a
  // pending-access MEMBER, but must still be able to accept ToS/Privacy (and
  // the re-accept gate) before an admin grants full access. The route itself
  // requires a valid session, and out-of-domain users can't create accounts,
  // so exempting it from the role gate opens no hole. (Phase 3)
  '/api/legal',
  // Public, unauthenticated funnel: inbound consent capture from a public
  // landing page. No session is required (or desirable) because the point is
  // public reachability.
  '/api/consent',
];

interface SessionUserRow {
  id: string;
  email: string;
  role: string | null;
  banned: boolean;
  suspended_until: string | null;
}

/**
 * Resolve the requester's user row from the better-auth session token, if one
 * was presented. The cookie value is `<token>.<hmac>`; the DB lookup keys on
 * the unguessable random token, and every data route still runs better-auth's
 * fully-verified getSession afterward — this layer only ever DENIES.
 */
async function lookupSessionUser(req: NextRequest): Promise<SessionUserRow | null> {
  const cookie =
    req.cookies.get('__Secure-better-auth.session_token')?.value ??
    req.cookies.get('better-auth.session_token')?.value;
  const bearer = req.headers.get('authorization');
  const rawValue =
    cookie ?? (bearer?.startsWith('Bearer ') ? bearer.slice(7).trim() : undefined);
  if (!rawValue) return null;

  const token = decodeURIComponent(rawValue).split('.')[0];
  if (!token) return null;

  const [row] = await sql`
    SELECT u.id, u.email, u.role, u.banned, u.suspended_until
    FROM session s
    JOIN "user" u ON u.id = s."userId"
    WHERE s.token = ${token} AND s."expiresAt" > now()
    LIMIT 1
  `;
  return (row as SessionUserRow | undefined) ?? null;
}

/**
 * Domain-lock layer 3 + role gate for authenticated app pages and APIs.
 * Deny-only: requests without a resolvable session pass through to the
 * routes' own auth handling.
 */
export async function enforceAccessGate(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  if (ACCESS_GATE_EXEMPT_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  let user: SessionUserRow | null;
  try {
    user = await lookupSessionUser(req);
  } catch (error) {
    // A lookup failure passes through: every data route still runs its own
    // fully-verified session check, so this cannot widen access — it only
    // skips the extra layer for this one request instead of taking the whole
    // app down with the DB hiccup.
    console.error('[middleware] session lookup failed', error);
    return NextResponse.next();
  }
  if (!user) return NextResponse.next();

  const isApi = pathname.startsWith('/api/');

  // Ban gate (Phase 4): a banned or currently-suspended user is rejected even
  // on an already-minted session. Deleting their session rows on ban makes
  // this immediate; this check also covers a session that outlived the DELETE
  // and rejects the account regardless of role/domain.
  if (isAccessDenied(user)) {
    if (isApi) {
      return NextResponse.json(
        { error: 'Account suspended', code: 'ACCOUNT_BANNED' },
        { status: 403 }
      );
    }
    return NextResponse.redirect(new URL('/access-restricted', req.url));
  }

  if (!isEmailDomainAllowed(user.email)) {
    if (isApi) {
      return NextResponse.json(
        { error: 'Access restricted: account domain is not authorized' },
        { status: 403 }
      );
    }
    return NextResponse.redirect(new URL('/access-restricted', req.url));
  }

  if (!hasRequiredRole(user.role)) {
    if (isApi) {
      return NextResponse.json(
        { error: 'Access pending: your account has not been granted access yet' },
        { status: 403 }
      );
    }
    return NextResponse.redirect(new URL('/pending-access', req.url));
  }

  // Re-accept gate: an authenticated, allowed user who has NOT accepted the
  // current ToS + Privacy versions is held at the /legal/accept interstitial
  // for page requests. On a version bump, existing acceptance rows carry the
  // old version, so this fires until they re-accept. API requests are not
  // redirected here (their own routes enforce what they need); this gate is
  // about the interactive app surface. The interstitial page itself and the
  // acceptance endpoint are exempt so the user can actually accept.
  if (!isApi && pathname !== '/legal/accept') {
    try {
      const rows = await sql`
        SELECT document_type FROM legal_acceptances
        WHERE user_id = ${user.id}
          AND (
            (document_type = ${ACCEPTANCE_DOC_TYPES.tos} AND version = ${REQUIRED_ACCEPTANCE_VERSIONS.tos})
            OR (document_type = ${ACCEPTANCE_DOC_TYPES.privacy} AND version = ${REQUIRED_ACCEPTANCE_VERSIONS.privacy})
          )
      `;
      const accepted = new Set((rows as { document_type: string }[]).map((r) => r.document_type));
      const needsReaccept =
        !accepted.has(ACCEPTANCE_DOC_TYPES.tos) || !accepted.has(ACCEPTANCE_DOC_TYPES.privacy);
      if (needsReaccept) {
        return NextResponse.redirect(new URL('/legal/accept', req.url));
      }
    } catch (error) {
      // Fail-open on a DB hiccup: never lock the whole app out of a transient
      // error. The gate re-fires on the next request.
      console.error('[middleware] legal re-accept check failed', error);
    }
  }

  return NextResponse.next();
}

export function middleware(req: NextRequest): Promise<NextResponse> {
  if (req.nextUrl.pathname.startsWith('/api/v1/')) {
    return enforceRateLimit(req);
  }
  return enforceAccessGate(req);
}

// v1 API takes the key path (rate limit + owner check); the app pages and the
// session-authed API tree take the access gate. Marketing pages, /account/*
// (sign-in/up), /access-restricted, /pending-access and static assets are NOT
// matched — they must stay reachable for unauthenticated + locked-out users.
export const config = {
  matcher: [
    '/api/:path*',
    '/admin/:path*',
    '/dashboard/:path*',
    '/campaigns/:path*',
    '/inbox/:path*',
    '/approvals/:path*',
    '/leads/:path*',
    '/crm/:path*',
    '/lead-finder/:path*',
    '/contracts/:path*',
    '/analytics/:path*',
    '/settings/:path*',
    '/health/:path*',
    '/imports/:path*',
  ],
};
