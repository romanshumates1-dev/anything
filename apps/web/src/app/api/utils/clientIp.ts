/**
 * Trusted client-IP resolution.
 *
 * WHY THIS EXISTS (defect: rate-limit bypass)
 * -------------------------------------------
 * 12 files independently read `x-forwarded-for.split(',')[0]`, i.e. the
 * LEFTMOST entry. In a forwarding chain the leftmost entry is the one the
 * *client* wrote; every proxy APPENDS the address it observed to the right.
 * Trusting [0] therefore trusts attacker-controlled input, which defeats every
 * IP rate limit in the app (contact form, portal endpoints, and critically the
 * 5/hour `reset-password` anti-brute-force control) by rotating the header per
 * request. The same spoofed value was also written into audit tables as
 * forensic evidence.
 *
 * A second bug: falling back to a literal `'unknown'` bucketed every
 * unidentified caller together, so one client could exhaust the shared window
 * and deny service to everyone else.
 *
 * RESOLUTION ORDER
 * 1. Edge headers the client cannot inject because the edge overwrites them:
 *    `cf-connecting-ip` (Cloudflare), `x-vercel-forwarded-for` (Vercel),
 *    `x-real-ip` (nginx).
 * 2. `x-forwarded-for`, taking the RIGHTMOST address - the one appended by the
 *    nearest trusted proxy - never the leftmost.
 * 3. Otherwise `null`. Callers decide what an unknown client means; we do not
 *    invent a shared bucket here.
 *
 * Every candidate is shape-validated (IPv4/IPv6, length-capped) so a forged
 * header cannot smuggle arbitrary text into audit rows or log lines.
 */

/** Headers set/overwritten by a trusted edge, in decreasing trust order. */
const TRUSTED_SINGLE_HEADERS = ['cf-connecting-ip', 'x-real-ip'] as const;

/** Headers that carry a chain and must be read right-to-left. */
const TRUSTED_CHAIN_HEADERS = ['x-vercel-forwarded-for'] as const;

/** Longest value accepted; a real IP never approaches this. */
const MAX_IP_LENGTH = 64;

const IPV4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/**
 * IPv6, including `::` compression.
 *
 * The obvious `([0-9a-f]{1,4}:){n}` form is WRONG: it requires every group to
 * be non-empty, so it rejects the common compressed forms `::1`, `2001:db8::1`
 * and `::`. That bug made every compressed IPv6 client resolve to `null`, which
 * (because the rate limiter fails closed on null) would have locked IPv6 users
 * out entirely. Each alternative below covers one legal `::` placement.
 */
const IPV6 = new RegExp(
  '^(?:' +
    // full form: 8 groups
    '(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|' +
    // one or more leading groups followed by ::
    '(?:[0-9a-f]{1,4}:){1,7}:|' +
    '(?:[0-9a-f]{1,4}:){1,6}:[0-9a-f]{1,4}|' +
    '(?:[0-9a-f]{1,4}:){1,5}(?::[0-9a-f]{1,4}){1,2}|' +
    '(?:[0-9a-f]{1,4}:){1,4}(?::[0-9a-f]{1,4}){1,3}|' +
    '(?:[0-9a-f]{1,4}:){1,3}(?::[0-9a-f]{1,4}){1,4}|' +
    '(?:[0-9a-f]{1,4}:){1,2}(?::[0-9a-f]{1,4}){1,5}|' +
    '[0-9a-f]{1,4}:(?::[0-9a-f]{1,4}){1,6}|' +
    ':(?::[0-9a-f]{1,4}){1,7}|' +
    '::' +
    ')(?:%.+)?$',
  'i'
);

/**
 * Normalise one candidate token into a canonical IP, or null if it is not one.
 * Strips an optional `:port` from IPv4 (seen on some proxies) and rejects
 * anything that is not plausibly an address.
 */
function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (!value || value.length > MAX_IP_LENGTH) return null;

  // `1.2.3.4:5678` -> `1.2.3.4` (IPv6 keeps its colons and is checked later).
  const v4WithPort = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):\d{1,5}$/.exec(value);
  if (v4WithPort) value = v4WithPort[1];

  // Bracketed IPv6 with optional port: `[::1]:8080`.
  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(value);
  if (bracketed) value = bracketed[1];

  // A chain accidentally passed whole: take the last element.
  if (value.includes(',')) value = value.slice(value.lastIndexOf(',') + 1).trim();

  if (IPV4.test(value)) {
    const octets = value.split('.');
    // Reject octets > 255 (e.g. 999.1.1.1) rather than logging nonsense.
    if (octets.some(o => Number(o) > 255)) return null;
    return value;
  }

  // IPv4-mapped IPv6 (::ffff:1.2.3.4) - unwrap to the IPv4 form.
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(value);
  if (mapped) return normalizeIp(mapped[1]);

  if (IPV6.test(value)) return value.toLowerCase();

  return null;
}

/** Anything that exposes a header map: a web `Request` or Next's `headers()`. */
export type HeaderSource = Request | Headers;

function headersOf(source: HeaderSource): Headers {
  return source instanceof Headers ? source : source.headers;
}

/**
 * Resolve the calling client's IP address, or `null` when it cannot be
 * determined from a trusted source.
 *
 * Never returns a shared placeholder such as `'unknown'` - callers that need a
 * rate-limit bucket must decide explicitly what to do about `null`.
 *
 * Accepts either a `Request` or Next's `headers()` result, because several
 * acceptance/legal routes read forwarded headers from `await headers()` rather
 * than from a `Request` object.
 */
export function getClientIp(source: HeaderSource): string | null {
  const headers = headersOf(source);

  // 1. Single-value edge headers: the edge overwrites whatever the client sent.
  for (const header of TRUSTED_SINGLE_HEADERS) {
    const ip = normalizeIp(headers.get(header));
    if (ip) return ip;
  }

  // 2. Chain headers: trust the RIGHTMOST entry (added by our proxy).
  for (const header of TRUSTED_CHAIN_HEADERS) {
    const ip = takeRightmost(headers.get(header));
    if (ip) return ip;
  }

  // 3. `x-forwarded-for` is only trustworthy behind a proxy that appends to it.
  //    The rightmost address is the one that proxy observed; anything to its
  //    left was chosen by the client.
  return takeRightmost(headers.get('x-forwarded-for'));
}

/** Read the last (proxy-appended) address out of a comma-separated chain. */
function takeRightmost(raw: string | null): string | null {
  if (!raw) return null;
  if (raw.length > 1024) return null; // header-flooding guard before splitting
  const parts = raw.split(',');
  for (let i = parts.length - 1; i >= 0; i--) {
    const ip = normalizeIp(parts[i]);
    if (ip) return ip;
  }
  return null;
}

/**
 * Identifier for a rate-limit bucket.
 *
 * Returns a real IP when one can be resolved. When it cannot, returns `null`
 * rather than a shared literal: `rateLimitByUser` fails closed on `null`, so an
 * unidentifiable caller is limited instead of being handed an unlimited bucket
 * (or allowed to poison a shared one).
 */
export function rateLimitIdentifier(source: HeaderSource): string | null {
  return getClientIp(source);
}
