/**
 * CSRF Protection
 *
 * Validates that state-changing requests come from our own frontend.
 * Uses Origin/Referer header validation (SameSite cookies provide additional protection).
 */

const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:4000',
  process.env.NEXT_PUBLIC_APP_URL,
  process.env.BETTER_AUTH_URL,
].filter(Boolean) as string[];

interface CsrfResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validate that a request comes from an allowed origin.
 * Should be called on all POST/PUT/DELETE/PATCH requests.
 */
export function validateCsrf(request: Request): CsrfResult {
  // Skip CSRF for API key authenticated requests (machine-to-machine)
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer df_')) {
    return { valid: true };
  }

  // Check Origin header first (most reliable)
  const origin = request.headers.get('origin');
  if (origin) {
    // `Origin: null` (sandboxed iframe, data: URL) is a real header value that
    // `new URL()` cannot parse — it must REJECT, not throw a 500.
    let originUrl: URL;
    try {
      originUrl = new URL(origin);
    } catch {
      return { valid: false, reason: `Origin '${origin}' is not a valid origin` };
    }
    const originHost = originUrl.host;

    for (const allowed of ALLOWED_ORIGINS) {
      try {
        const allowedUrl = new URL(allowed);
        if (allowedUrl.host === originHost) {
          return { valid: true };
        }
      } catch {
        continue;
      }
    }

    return { valid: false, reason: `Origin '${origin}' not allowed` };
  }

  // Fallback to Referer header
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      const refererHost = refererUrl.host;

      for (const allowed of ALLOWED_ORIGINS) {
        try {
          const allowedUrl = new URL(allowed);
          if (allowedUrl.host === refererHost) {
            return { valid: true };
          }
        } catch {
          continue;
        }
      }
    } catch {
      // Invalid referer URL
    }

    return { valid: false, reason: `Referer '${referer}' not allowed` };
  }

  // No Origin or Referer - likely a same-origin request or dev environment
  // In production, you may want to reject these
  if (process.env.NODE_ENV === 'production') {
    // Allow requests with X-Requested-With header (AJAX requests from same origin)
    const xRequestedWith = request.headers.get('x-requested-with');
    if (xRequestedWith === 'XMLHttpRequest') {
      return { valid: true };
    }

    // For production, require at least one header
    // But don't block legitimate form submissions
    const contentType = request.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      // JSON requests without origin/referer in production are suspicious
      // but we allow them for now with a warning
      console.warn('[CSRF] JSON request without Origin/Referer in production');
      return { valid: true };
    }
  }

  return { valid: true };
}

/**
 * Middleware helper to reject invalid CSRF requests.
 */
export function requireValidCsrf(request: Request): Response | null {
  const result = validateCsrf(request);
  if (!result.valid) {
    console.warn(`[CSRF] Rejected: ${result.reason}`);
    return Response.json({ error: 'CSRF validation failed' }, { status: 403 });
  }
  return null;
}

// ---------------------------------------------------------------------------
// Central cross-site enforcement for middleware (one choke point).
// ---------------------------------------------------------------------------
//
// WHY THIS EXISTS SEPARATELY FROM `validateCsrf` ABOVE
// -----------------------------------------------------
// `validateCsrf` is called by a handful of routes. The session cookie is
// `SameSite=None` (load-bearing for mobile iframes — see src/lib/auth.ts), so
// EVERY state-changing /api/* route is reachable from a cross-site
// `text/plain` fetch: that content type is CORS-"simple", so the browser sends
// the request (with cookie) WITHOUT a preflight, and `request.json()` parses
// the body regardless of content type. A per-route helper only protects the
// routes somebody remembered to edit; this function is wired into
// src/middleware.ts so the check covers every route — including future ones.

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Origins we trust in addition to the request's own host. Evaluated lazily so
 * tests (and per-deployment env changes) see current values.
 */
function trustedOriginHosts(): Set<string> {
  const hosts = new Set<string>();
  const add = (value: string | undefined, transform?: (v: string) => string) => {
    if (!value) return;
    try {
      hosts.add(new URL(transform ? transform(value) : value).host);
    } catch {
      // Malformed env value simply contributes nothing.
    }
  };
  add('http://localhost:3000');
  add('http://localhost:4000');
  add(process.env.NEXT_PUBLIC_APP_URL);
  add(process.env.BETTER_AUTH_URL);
  add(process.env.EXPO_PUBLIC_PROXY_BASE_URL);
  add(
    process.env.NEXT_PUBLIC_CREATE_HOST
      ? `https://${process.env.NEXT_PUBLIC_CREATE_HOST}`
      : undefined
  );
  return hosts;
}

function isAllowedOrigin(originHeader: string, requestHosts: Set<string>): boolean {
  let parsed: URL;
  try {
    parsed = new URL(originHeader);
  } catch {
    // Includes the literal `Origin: null` (sandboxed iframe / data: URL) —
    // treated as cross-site because we cannot attribute it to any host.
    return false;
  }
  // Host equality (or hostname equality, so an explicit default port on one
  // side does not read as a different site) against the hosts this request is
  // actually served for. Scheme is intentionally ignored: dev runs http while
  // an upstream proxy may terminate tls.
  if (requestHosts.has(parsed.host) || requestHosts.has(parsed.hostname)) {
    return true;
  }
  return trustedOriginHosts().has(parsed.host);
}

/** Hosts this request is served for: the URL host plus proxy-supplied hints. */
function requestHostSet(request: Request, requestUrl: URL): Set<string> {
  const hosts = new Set<string>([requestUrl.host, requestUrl.hostname]);
  // Behind a reverse proxy (Cloudflare Workers in this repo's deployment) the
  // internal `Host` can differ from the site the browser is on. Without
  // reading the forwarded header, EVERY app mutation would 403 in production.
  for (const header of ['x-forwarded-host', 'host']) {
    const value = request.headers.get(header);
    if (!value) continue;
    for (const part of value.split(',')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      hosts.add(trimmed);
      // Strip an explicit port so `app.example.com:443` matches `app.example.com`.
      const withoutPort = trimmed.replace(/:\d+$/, '');
      hosts.add(withoutPort);
    }
  }
  return hosts;
}

/**
 * Returns a 403 Response when a state-changing API request is provably
 * cross-site, otherwise null (request proceeds).
 *
 * Deliberate allowances (each one is a compatibility requirement, not an
 * oversight):
 * - Safe methods (GET/HEAD/OPTIONS) never trigger it: they must not have
 *   side effects anyway, and CORS preflights (OPTIONS) carry no cookies.
 * - Requests WITHOUT Origin and WITHOUT Referer pass: browsers always send
 *   Origin on cross-site state-changing requests, so its absence marks
 *   non-browser traffic (Stripe/Twilio/esign webhooks, health probes, curl,
 *   M2M jobs) — those never carry a victim's ambient cookies.
 * - `Authorization: Bearer df_*` (public v1 API keys) passes: the caller is
 *   authenticated by header, not by ambient cookie, mirroring the skip that
 *   `validateCsrf` already applies.
 */
export function crossSiteRejection(request: Request): Response | null {
  if (!UNSAFE_METHODS.has(request.method.toUpperCase())) return null;

  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer df_')) return null;

  let requestUrl: URL;
  try {
    requestUrl = new URL(request.url);
  } catch {
    return null; // Unparseable URL is not this check's failure to own.
  }
  const requestHosts = requestHostSet(request, requestUrl);

  const origin = request.headers.get('origin');
  if (origin !== null) {
    if (isAllowedOrigin(origin, requestHosts)) return null;
    console.warn(`[CSRF] Rejected cross-site ${request.method} origin=${origin}`);
    return Response.json(
      { error: 'Cross-origin request rejected' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  // No Origin: some older clients only populate Referer. A cross-site Referer
  // without Origin is still a browser-initiated cross-site call.
  const referer = request.headers.get('referer');
  if (referer && !isAllowedOrigin(referer, requestHosts)) {
    console.warn(`[CSRF] Rejected cross-site ${request.method} referer=${referer}`);
    return Response.json(
      { error: 'Cross-origin request rejected' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  return null;
}

