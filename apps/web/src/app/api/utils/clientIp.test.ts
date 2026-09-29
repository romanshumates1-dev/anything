/**
 * Client IP resolution - regression tests for the rate-limit bypass defect.
 *
 * The pre-fix implementation was `x-forwarded-for.split(',')[0]`, i.e. the
 * LEFTMOST entry of a forwarding chain. Because every proxy APPENDS the address
 * it observed to the right, the leftmost entry is the one the CLIENT wrote, so
 * an attacker rotated the header per request and got a fresh rate-limit bucket
 * every time - completely defeating the 5/hour reset-password anti-brute-force
 * limit, the contact form limit and both portal limits. The same forgeable
 * value was written into audit tables as forensic evidence.
 *
 * These tests pin the three properties that close that hole:
 *   1. edge-set headers (cf-connecting-ip / x-real-ip) win and cannot be forged
 *      through the edge,
 *   2. a forwarding chain is read RIGHTMOST (the proxy-appended address),
 *   3. an unidentifiable caller yields `null`, never a shared 'unknown' bucket.
 */
import { describe, it, expect } from 'vitest';
import { getClientIp, rateLimitIdentifier, type HeaderSource } from './clientIp';

/** Build a Request carrying exactly the supplied headers. */
function req(headers: Record<string, string>): Request {
  return new Request('https://example.test/', { headers });
}

describe('getClientIp - trust precedence', () => {
  it('prefers cf-connecting-ip over any x-forwarded-for entry', () => {
    // Edge-set header is authoritative; the chain is still client-influenced.
    const ip = getClientIp(
      req({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '6.6.6.6' })
    );
    expect(ip).toBe('203.0.113.9');
  });

  it('prefers x-real-ip over a client-written forwarding chain', () => {
    const ip = getClientIp(req({ 'x-real-ip': '198.51.100.7', 'x-forwarded-for': '6.6.6.6' }));
    expect(ip).toBe('198.51.100.7');
  });

  it('accepts a bare Headers object (Next `await headers()`)', () => {
    const headers = new Headers({ 'cf-connecting-ip': '203.0.113.5' });
    expect(getClientIp(headers as HeaderSource)).toBe('203.0.113.5');
  });
});

describe('getClientIp - forwarding chain is read rightmost', () => {
  it('ignores the client-written LEFTMOST entry (the bypass)', () => {
    // Classic attack: attacker claims 6.6.6.6 first, proxy appends the real
    // address. The old code returned 6.6.6.6 and handed over a fresh bucket.
    const ip = getClientIp(req({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }));
    expect(ip).toBe('203.0.113.9');
    expect(ip).not.toBe('6.6.6.6');
  });

  it('rotating the spoofed leftmost entry no longer changes the bucket', () => {
    const proxyAppended = '203.0.113.9';
    const a = getClientIp(req({ 'x-forwarded-for': `1.1.1.1, ${proxyAppended}` }));
    const b = getClientIp(req({ 'x-forwarded-for': `2.2.2.2, ${proxyAppended}` }));
    const c = getClientIp(req({ 'x-forwarded-for': `3.3.3.3, ${proxyAppended}` }));
    // Every forged attempt maps to the SAME real client.
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(a).toBe('203.0.113.9');
  });

  it('walks left past malformed entries to find the proxy address', () => {
    const ip = getClientIp(req({ 'x-forwarded-for': 'junk, ?, 198.51.100.7' }));
    expect(ip).toBe('198.51.100.7');
  });

  it('returns a single-entry chain (no proxy) as-is', () => {
    expect(getClientIp(req({ 'x-forwarded-for': '192.0.2.1' }))).toBe('192.0.2.1');
  });
});

describe('getClientIp - fails closed on unidentifiable callers', () => {
  it('returns null rather than a shared placeholder', () => {
    // The old fallback `|| 'unknown'` put every unidentified caller in one
    // bucket: an attacker could omit the header for unlimited requests, or
    // exhaust the shared window to deny service to everyone else.
    expect(getClientIp(req({}))).toBeNull();
  });

  it('returns null for non-address text (header smuggling)', () => {
    expect(getClientIp(req({ 'x-forwarded-for': 'not-an-ip' }))).toBeNull();
    expect(getClientIp(req({ 'x-forwarded-for': '<script>alert(1)</script>' }))).toBeNull();
    expect(getClientIp(req({ 'x-forwarded-for': "'; DROP TABLE rate_limits;--" }))).toBeNull();
    expect(getClientIp(req({ 'cf-connecting-ip': 'unknown' }))).toBeNull();
  });

  it('rejects out-of-range IPv4 octets', () => {
    expect(getClientIp(req({ 'cf-connecting-ip': '999.1.1.1' }))).toBeNull();
    expect(getClientIp(req({ 'cf-connecting-ip': '1.2.3.400' }))).toBeNull();
  });

  it('rejects an oversized header before doing any work', () => {
    const flood = '1.2.3.4'.repeat(400);
    expect(getClientIp(req({ 'x-forwarded-for': flood }))).toBeNull();
  });

  it('rateLimitIdentifier mirrors getClientIp (no separate fallback)', () => {
    expect(rateLimitIdentifier(req({}))).toBeNull();
    expect(rateLimitIdentifier(req({ 'cf-connecting-ip': '203.0.113.9' }))).toBe('203.0.113.9');
  });
});

describe('getClientIp - address normalization', () => {
  it('strips an IPv4 :port appended by some proxies', () => {
    expect(getClientIp(req({ 'cf-connecting-ip': '203.0.113.9:54321' }))).toBe('203.0.113.9');
  });

  it('unwraps IPv4-mapped IPv6', () => {
    expect(getClientIp(req({ 'cf-connecting-ip': '::ffff:203.0.113.9' }))).toBe('203.0.113.9');
  });

  it('accepts and lowercases IPv6', () => {
    expect(getClientIp(req({ 'cf-connecting-ip': '2001:DB8::1' }))).toBe('2001:db8::1');
  });

  it('unbrackets a bracketed IPv6 with a port', () => {
    expect(getClientIp(req({ 'x-forwarded-for': '[2001:db8::1]:443' }))).toBe('2001:db8::1');
  });

  it('ignores a trusted header that does not hold an address', () => {
    // Falls through to x-forwarded-for instead of returning garbage.
    const ip = getClientIp(req({ 'cf-connecting-ip': 'garbage', 'x-forwarded-for': '192.0.2.5' }));
    expect(ip).toBe('192.0.2.5');
  });
});
