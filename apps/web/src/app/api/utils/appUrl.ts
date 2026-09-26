/**
 * Absolute base URL for redirects handed to a payment provider.
 *
 * Validated rather than trusted: `process.env.NEXT_PUBLIC_APP_URL` interpolated
 * straight into a Stripe `success_url` produces `undefined/settings/billing`
 * when unset, and the mistake would only surface after the customer had already
 * been charged. Both billing routes therefore call this before creating a
 * Checkout session.
 */
export function appBaseUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_APP_URL || '').trim();

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      'NEXT_PUBLIC_APP_URL is not configured as an absolute URL (e.g. https://app.example.com)'
    );
  }

  // localhost is allowed so the flow is exercisable in development; anything
  // else must be https, because a payment redirect over plain http would leak
  // the session and look broken to the customer.
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !isLocal) {
    throw new Error('NEXT_PUBLIC_APP_URL must use https outside local development');
  }

  return url.origin;
}
