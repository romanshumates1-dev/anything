/**
 * SSRF defence for caller-supplied outbound URLs.
 *
 * These are the classic bypasses. A test that only checked "http://127.0.0.1 is
 * rejected" would pass while every one of these got through, so the cases are
 * chosen from the actual evasion techniques rather than from convenience.
 */
import { describe, it, expect } from 'vitest';
import { assertSafeOutboundUrl, UnsafeUrlError } from '@/app/api/utils/ssrf';

const blocked = (u: string) => {
  expect(() => assertSafeOutboundUrl(u), `should block ${u}`).toThrow(UnsafeUrlError);
};
const allowed = (u: string) => {
  expect(() => assertSafeOutboundUrl(u), `should allow ${u}`).not.toThrow();
};

describe('assertSafeOutboundUrl - internal targets are blocked', () => {
  it.each([
    'https://127.0.0.1/hook',
    'https://127.0.0.1:5432/hook',
    'https://127.1.2.3/hook',
    'https://0.0.0.0/hook',
    'https://[::1]/hook',
    'https://localhost/hook',
    'https://LOCALHOST:8080/hook',
  ])('blocks loopback %s', blocked);

  it.each([
    'https://169.254.169.254/latest/meta-data/', // AWS/GCP/Azure metadata
    'https://169.254.1.1/hook',
    'https://[fe80::1]/hook',
  ])('blocks link-local / metadata %s', blocked);

  it.each([
    'https://10.0.0.1/hook',
    'https://10.255.255.254/hook',
    'https://172.16.0.1/hook',
    'https://172.31.255.254/hook',
    'https://192.168.1.1/hook',
    'https://[fc00::1]/hook',
    'https://[fd12:3456::1]/hook',
  ])('blocks private network %s', blocked);

  it.each([
    'https://100.64.0.1/hook', // CGNAT
    'https://198.18.0.1/hook', // benchmarking
    'https://192.0.0.1/hook',
    'https://224.0.0.1/hook', // multicast
    'https://255.255.255.255/hook',
  ])('blocks special-use %s', blocked);

  it('blocks IPv4-mapped IPv6 that wraps a private address', () => {
    // ::ffff:127.0.0.1 reaches loopback despite looking like IPv6.
    blocked('https://[::ffff:127.0.0.1]/hook');
    blocked('https://[::ffff:10.0.0.1]/hook');
  });

  it('blocks malformed and decimal-encoded IPs', () => {
    blocked('https://999.999.999.999/hook');
    // 2130706433 is 127.0.0.1 in decimal - a well-known parser-differential trick.
    blocked('https://2130706433/hook');
  });
});

describe('assertSafeOutboundUrl - scheme and shape', () => {
  it.each([
    'http://example.com/hook', // cleartext credentials
    'file:///etc/passwd',
    'gopher://example.com/',
    'ftp://example.com/',
    'data:text/html,<script>alert(1)</script>',
    'javascript:alert(1)',
  ])('blocks non-https scheme %s', blocked);

  it('blocks embedded credentials', () => {
    blocked('https://user:pass@example.com/hook');
    blocked('https://user@example.com/hook');
  });

  it('blocks malformed input and non-strings without throwing raw errors', () => {
    for (const bad of ['', '   ', 'not a url', '://missing-scheme', null, undefined, 42, {}]) {
      expect(() => assertSafeOutboundUrl(bad)).toThrow(UnsafeUrlError);
    }
  });

  it('blocks a bare internal hostname with no dot', () => {
    blocked('https://intranet/hook');
    blocked('https://metadata/hook');
  });
});

describe('assertSafeOutboundUrl - legitimate destinations are allowed', () => {
  it.each([
    'https://example.com/hook',
    'https://hooks.slack.com/services/T00/B00/XXXX',
    'https://my-tenant.webhook.example.com/v1/callback?x=1',
    'https://8.8.8.8/hook',
    'https://[2606:4700:4700::1111]/hook',
  ])('allows %s', allowed);

  it('returns the parsed URL so callers can reuse it', () => {
    const u = assertSafeOutboundUrl('https://example.com/hook?a=1');
    expect(u.hostname).toBe('example.com');
    expect(u.protocol).toBe('https:');
    expect(u.searchParams.get('a')).toBe('1');
  });
});
