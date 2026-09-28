/**
 * SECURITY REGRESSION GUARD — client-side secret access and reversible token
 * construction.
 *
 * Defect found 2026-09-26: `components/compliance/CANSPAMFooter.tsx` is a
 * `'use client'` file that read `process.env.EMAIL_UNSUB_SECRET` and emitted
 * unsubscribe links as `base64(`${contactId}:${secret}`)`.
 *
 * Two distinct problems, and the second is the dangerous one:
 *  1. In a client bundle Next replaces any non-`NEXT_PUBLIC_` `process.env.X`
 *     with `undefined`, so the code silently fell through to a hardcoded
 *     `'dev-secret'` — the link was never what the server would verify.
 *  2. base64 is an ENCODING, not a MAC. Any recipient of such an email could
 *     decode the token and read the unsubscribe secret itself, and forge
 *     tokens for other contacts. The live path (`withCanSpamFooter` in
 *     `api/utils/emailDriver.ts`) never had this flaw because it receives an
 *     already-minted, server-signed URL; the dead helper did.
 *
 * This guard fails the build if either pattern returns, anywhere under src/:
 *  A. a `'use client'` file referencing a non-`NEXT_PUBLIC_` env var whose
 *     name looks secret-bearing;
 *  B. any shipped file base64/`Buffer.from`-encoding an expression that also
 *     mentions a secret-shaped identifier.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { scanSource, readSource, SRC_ROOT } from './_sourceScan';

const files = scanSource(SRC_ROOT, {
  extensions: ['ts', 'tsx', 'mjs', 'cjs'],
  skipDirs: ['node_modules', '__tests__', '.next'],
  excludeTests: true,
});

const USE_CLIENT_RE = /^\s*(?:\/\/.*\n|\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/m;

/** Secret-bearing env var that is NOT exposed to the browser. */
const SECRET_ENV_RE =
  /process\.env\.(?!NEXT_PUBLIC_)[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|DSN)[A-Z0-9_]*/;

const SECRET_IDENT_RE = /(SECRET|_TOKEN|API_?KEY|SIGNATURE|PRIVATE_KEY)/i;

/**
 * Reversible encoding of secret-shaped material.
 *
 * Only ENCODING counts (`Buffer.from(x).toString('base64')`). A bare
 * `Buffer.from(someSignature)` is DECODING a hex signature for comparison
 * (esign/twilio webhook verification) and is not a leak.
 *
 * `auth` is the one documented exception: HTTP Basic auth is *defined* as
 * base64(user:password) (RFC 7617) — e.g. the Twilio driver building an
 * Authorization header server-side. That secret goes into a request header,
 * never into a URL, a log, or a client bundle: the opposite of the defect
 * this guard exists to stop.
 */
const REVERSIBLE_ENCODE_RE = /Buffer\.from\([^)]*\)\s*\.toString\(\s*['"]base64/;
const BASIC_AUTH_EXCEPTION_RE = /^\s*const\s+\w*auth\w*\s*=/i;

function codeLines(text: string): string[] {
  return text
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
}

describe('client secret / reversible token guard', () => {
  it('A: no shipped `use client` file reads a non-public secret env var', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readSource(file);
      if (!USE_CLIENT_RE.test(text)) continue;
      for (const line of codeLines(text)) {
        if (SECRET_ENV_RE.test(line)) {
          offenders.push(`${file}: ${line.trim()}`);
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('B: no shipped file reversibly ENCODES a secret-shaped expression', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const line of codeLines(readSource(file))) {
        if (!REVERSIBLE_ENCODE_RE.test(line)) continue;
        if (BASIC_AUTH_EXCEPTION_RE.test(line)) continue; // RFC 7617 Basic auth
        // The question is not "does this line mention a secret" but "is secret
        // MATERIAL inside the encoded expression". portalToken.ts is correct
        // and still matches the loose version: it base64url-encodes the
        // PAYLOAD and then HMAC-signs it, with the secret only ever used as a
        // signing key. Encoding a secret is what leaks it.
        const encoded = line.match(/Buffer\.from\(([^)]*)\)/)?.[1] ?? '';
        if (
          SECRET_IDENT_RE.test(encoded) ||
          /process\.env\.[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)/.test(encoded)
        ) {
          offenders.push(`${file}: ${line.trim()}`);
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('C: the CAN-SPAM footer no longer mints unsubscribe tokens in the client', () => {
    const footer = readSource(
      join(process.cwd(), 'src', 'components', 'compliance', 'CANSPAMFooter.tsx')
    );
    expect(footer).not.toMatch(/EMAIL_UNSUB_SECRET/);
    expect(footer).not.toMatch(/generateCANSPAMFooterHTML/);
    expect(footer).not.toMatch(/dev-secret/);
  });

  it('E: self-check — the detector still flags the ORIGINAL vulnerable line', () => {
    // A ratchet that no longer detects the bug it was written for is worse
    // than no ratchet, so the detection logic is pinned against the exact
    // line that shipped (CANSPAMFooter.tsx, removed 2026-09-26).
    const vulnerable =
      "  const token = Buffer.from(`${contactId}:${process.env.EMAIL_UNSUB_SECRET}`).toString('base64url');";
    const encoded = vulnerable.match(/Buffer\.from\(([^)]*)\)/)?.[1] ?? '';
    expect(REVERSIBLE_ENCODE_RE.test(vulnerable)).toBe(true);
    expect(
      /process\.env\.[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)/.test(encoded)
    ).toBe(true);
  });

  it('D: the removed helper is not re-exported anywhere under src/', () => {
    const offenders: string[] = [];
    for (const file of files) {
      // Comments (including the removal note in compliance/index.ts) may name
      // the function; only live code counts.
      if (
        codeLines(readSource(file)).some((l) =>
          l.includes('generateCANSPAMFooterHTML')
        )
      ) {
        offenders.push(file);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
}, 30_000);
