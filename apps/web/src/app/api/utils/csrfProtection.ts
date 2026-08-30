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
    const originUrl = new URL(origin);
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
