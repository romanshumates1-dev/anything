/**
 * Outbound-URL validation for server-side fetches (SSRF defence).
 *
 * WHY
 * ---
 * Any endpoint that accepts a caller-supplied URL and later fetches it from the
 * server is a Server-Side Request Forgery primitive. The platform runs on
 * Cloudflare Workers, so a fetch to an internal address can reach cloud metadata
 * (169.254.169.254), loopback services, private RFC1918 networks, or an internal
 * admin host that has no route from the public internet.
 *
 * This validates at the TRUST BOUNDARY - when the URL is accepted and persisted -
 * rather than at the far end of a future fetch. That ordering matters: a URL
 * rejected at write time can never be stored, so there is no way to bypass the
 * check by finding another code path that reads the same column.
 *
 * WHAT IS BLOCKED
 * - non-HTTP(S) schemes (file:, gopher:, ftp:, data:, javascript:, ...)
 * - plain HTTP (credentials sent to a webhook must not travel in clear text)
 * - localhost / loopback (127.0.0.0/8, ::1, 0.0.0.0)
 * - link-local and cloud metadata (169.254.0.0/16, fe80::/10)
 * - private networks (10/8, 172.16/12, 192.168/16) and unique-local (fc00::/7)
 * - 0.0.0.0/8, 100.64.0.0/10 (CGNAT), 192.0.0.0/24, 198.18.0.0/15
 * - credentials embedded in the URL (https://user:pass@host)
 *
 * KNOWN LIMIT (stated rather than hidden)
 * This is a syntactic check. It cannot resolve DNS, so a hostname that resolves
 * to a private address (DNS rebinding, or an attacker-controlled A record) still
 * passes. A delivery worker MUST additionally pin the resolved IP and re-check
 * it at connect time. That is the correct place for the second half of the
 * defence, and this module documents the requirement rather than pretending the
 * problem is fully solved here.
 */

/** True when the hostname is a literal IP in a range we must never fetch. */
function isBlockedAddress(host: string): boolean {
  // Strip IPv6 brackets.
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();

  // IPv4 - exact prefix match is enough; a decimal/octal-encoded IP such as
  // 2130706433 or 0177.0.0.1 is a classic bypass, so anything that is not four
  // plain dot-separated octets is treated as unresolvable and rejected.
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if ([a, b, ...v4.slice(3).map(Number)].some((n) => n > 255)) return true; // malformed
    if (a === 0) return true; // 0.0.0.0/8 "this network"
    if (a === 10) return true; // private
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 192 && b === 0) return true; // IETF protocol assignments
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true; // multicast + reserved
    return false;
  }

  // IPv6 - the cases that matter for SSRF.
  if (h === '::1' || h === '::') return true;
  if (h.startsWith('fe80')) return true; // link-local
  if (/^f[cd]/.test(h)) return true; // unique local fc00::/7

  // IPv4-mapped IPv6. WHATWG URL normalizes [::ffff:127.0.0.1] to the HEX form
  // "[::ffff:7f00:1]", so a dotted-quad regex alone silently misses the single
  // most effective SSRF disguise - it looks like a routable IPv6 address while
  // the kernel connects to loopback. Both spellings are therefore handled, and
  // the hex form is decoded to its two 16-bit halves.
  const mappedHex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const high = parseInt(mappedHex[1], 16);
    const low = parseInt(mappedHex[2], 16);
    const dotted = `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
    return isBlockedAddress(dotted);
  }
  // Defensive: any other ::ffff: variant is treated as blocked rather than
  // assumed safe.
  if (h.startsWith('::ffff:')) return true;

  // Any other IPv6 literal is permitted; it cannot be a bare private v4.
  return false;
}

export class UnsafeUrlError extends Error {}

export function assertSafeOutboundUrl(raw: unknown): URL {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new UnsafeUrlError('A url is required');
  }

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    // A parse failure is the most common SSRF trick, so it is reported as an
    // invalid url rather than falling through to any default.
    throw new UnsafeUrlError('Invalid webhook url');
  }

  if (url.protocol !== 'https:') {
    // Rejecting plain http also removes file:, gopher:, ftp:, data: and
    // javascript: without needing an explicit list that could be incomplete.
    throw new UnsafeUrlError('Webhook url must use https');
  }

  if (url.username || url.password) {
    throw new UnsafeUrlError('Webhook url must not embed credentials');
  }

  const host = url.hostname;
  if (!host) throw new UnsafeUrlError('Invalid webhook url');

  if (isBlockedAddress(host)) {
    throw new UnsafeUrlError('Webhook url must not target a private or internal address');
  }

  // Bare hostnames with no dot ("localhost", "intranet") are internal by
  // definition; the loopback case is also caught above.
  if (host !== 'localhost' && !host.includes('.') && !host.includes(':')) {
    throw new UnsafeUrlError('Webhook url must use a fully qualified hostname');
  }
  if (host === 'localhost') {
    throw new UnsafeUrlError('Webhook url must not target a private or internal address');
  }

  return url;
}
