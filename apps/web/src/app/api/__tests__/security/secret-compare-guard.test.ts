/**
 * SECURITY REGRESSION GUARD - non-constant-time shared-secret comparisons.
 *
 * Class found by the 2026-09 secret sweep: twelve sites across nine files
 * authenticated webhooks/crons with `provided !== secret` (or template
 * equality against `Bearer ${secret}`), which short-circuits on the first
 * differing byte - a classic timing oracle for recovering the shared secret.
 * Two of those sites ALSO failed open when the env secret was unset
 * (`if (CRON_SECRET && provided !== CRON_SECRET)`), and one compared against
 * the interpolated literal `Bearer undefined`.
 *
 * All sites now go through `timingSafeSecretEqual` (utils/secretCompare.ts),
 * which hashes both sides and uses crypto.timingSafeEqual, failing closed on
 * missing/empty values.
 *
 * This guard statically scans the source and fails the build if a future
 * change reintroduces a raw `===`/`!==` comparison against a secret-shaped
 * identifier anywhere under src/ (excluding tests), or adds a new
 * `x-<something>-secret`/bearer gate that never calls the safe compare.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC_ROOT = join(process.cwd(), 'src');

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '__tests__' || e === '.next') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|cjs)$/.test(e) && !/\.test\.|\.spec\./.test(e)) {
      out.push(p);
    }
  }
  return out;
}

const files = walk(SRC_ROOT);

/**
 * A line is a violation when it performs a JS equality comparison
 * (`===` / `!==`, not `==` inside a string) against a secret-shaped
 * operand. Comment lines are exempt (they may quote the anti-pattern),
 * as are lines that already route through the safe helper.
 */
function isViolation(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
    return false;
  }
  if (trimmed.includes('timingSafeSecretEqual') || trimmed.includes('secretCompare')) {
    return false;
  }
  if (!/===|!==/.test(line)) return false;

  const secretOperand =
    // explicit env secret: process.env.CRON_SECRET / process.env['X_SECRET']
    /process\.env\.[A-Za-z_]*SECRET|process\.env\[['"][A-Z_]*SECRET/.source ||
    '';
  const secretIdent = '[A-Za-z_]*[Ss]ecret[A-Za-z_]*';
  // Signature-shaped operands (2026-09-26 re-review): the original sweep missed
  // `signature === expectedSignature` because neither side contained "secret".
  // HMAC/signature comparisons are the same timing-oracle class.
  const sigIdent = '[A-Za-z_]*[Ss]ignature[A-Za-z_]*';
  const ident = '[A-Za-z_$][A-Za-z0-9_$]*';

  const patterns = [
    // left === secretIdent  (e.g. provided !== secret, providedSecret !== CRON_SECRET)
    new RegExp(`${ident}\\s*(!==|===)\\s*(${secretIdent}|${sigIdent}|${secretOperand})`),
    // secretIdent === right  (e.g. secret !== process.env.X)
    new RegExp(`(${secretIdent}|${sigIdent}|${secretOperand})\\s*(!==|===)\\s*${ident}`),
    // property/header access compared with equality: get('x-local-dev') === devSecret
    new RegExp(`get\\(['"][^'"]*secret[^'"]*['"]\\)\\s*(!==|===)\\s*${ident}`, 'i'),
    // bearer template comparison: === `Bearer ${secret}`
    new RegExp('(!==|===)\\s*`Bearer \\$\\{'),
  ];

  return patterns.some((re) => {
    const m = re.exec(line);
    if (!m) return false;
    // `typeof x !== 'string'` style type guards are not comparisons of values
    if (/typeof\s/.test(line)) return false;
    // comparing against a string literal or number is not a secret compare
    const rhs = (m[2] ?? m[1] ?? '').toString().trim();
    if (/^['"`]/.test(rhs)) return false;
    // `x === undefined` / `x === null` are presence checks, not value compares
    if (/^(undefined|null|true|false|NaN)$/.test(rhs)) return false;
    // `.length` equality is a structural precheck (buffer lengths before
    // timingSafeEqual), not a secret-value comparison
    if (/\.length\s*(!==|===)/.test(line)) return false;
    return true;
  });
}

describe('secret-compare guard (timing-safe secrets)', () => {
  it('scans a non-trivial number of source files', () => {
    expect(files.length).toBeGreaterThan(300);
  });

  it('has no raw ===/!== comparisons against secret-shaped operands', () => {
    const violations: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      src.split(/\r?\n/).forEach((line, i) => {
        if (isViolation(line)) {
          violations.push(`${f.replace(SRC_ROOT, 'src')}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(violations, `Raw secret comparisons reintroduced:\n${violations.join('\n')}`).toEqual(
      []
    );
  });

  it('the safe helper itself exists and is wired into the known gates', () => {
    const helper = join(SRC_ROOT, 'app', 'api', 'utils', 'secretCompare.ts');
    expect(existsSync(helper)).toBe(true);

    // The 12 previously-vulnerable call sites must import the helper.
    const mustUseHelper = [
      ['app/api/sms/inbound/route.ts', '../../utils/secretCompare'],
      ['app/api/outreach/keyword-inbound/route.ts', '@/app/api/utils/secretCompare'],
      ['app/api/compliance/opt-out/route.ts', '../../utils/secretCompare'],
      ['app/api/email/inbound/route.ts', '@/app/api/utils/secretCompare'],
      ['app/api/email/ses-events/route.ts', '@/app/api/utils/secretCompare'],
      ['app/api/cron/earnings/route.ts', '@/app/api/utils/secretCompare'],
      ['app/api/system/cron/route.ts', '@/app/api/utils/secretCompare'],
      ['app/api/campaigns/automation/cron/route.ts', '@/app/api/utils/secretCompare'],
      ['app/api/jobs/process/route.ts', '../../utils/secretCompare'],
      ['app/api/pipeline/cron/route.ts', '@/app/api/utils/secretCompare'],
      ['app/api/utils/authz.ts', '@/app/api/utils/secretCompare'],
      ['lib/organization-context.ts', '@/app/api/utils/secretCompare'],
    ];
    for (const [rel, importPath] of mustUseHelper) {
      const src = readFileSync(join(SRC_ROOT, rel), 'utf8');
      expect(src.includes(`from '${importPath}'`), `${rel} lost its secretCompare import`).toBe(
        true
      );
      expect(src).toContain('timingSafeSecretEqual(');
    }
  });

/**
 * Ratchets added by the 2026-09-26 independent re-review:
 *  - the legacy duplicate webhook must never regain its own auth/SQL;
 *  - SNS signature verification must never go back to fail-open defaults.
 */
describe('duplicate-webhook + fail-open ratchets (re-review)', () => {
  it('legacy /api/inbound/sms stays a pure delegate to the canonical handler', () => {
    const src = readFileSync(join(SRC_ROOT, 'app', 'api', 'inbound', 'sms', 'route.ts'), 'utf8');
    expect(src).toContain("from '../../sms/inbound/route'");
    expect(src).toContain('canonicalPost(request)');
    // No own DB access, env reads, or HMAC logic may creep back in — all of
    // that lives in /api/sms/inbound where it is tested.
    expect(src).not.toMatch(/process\.env\./);
    expect(src).not.toMatch(/createHmac|from '..\/..\/utils\/sql'|requireSession/);
  });

  it('SNS webhook signature verification is fail-closed by default', () => {
    const src = readFileSync(
      join(SRC_ROOT, 'app', 'api', 'sms', 'sns-inbound', 'route.ts'),
      'utf8'
    );
    // Strip comments: the route's own header comment QUOTES the old fail-open
    // gate for documentation purposes.
    const code = src
      .split(/\r?\n/)
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      })
      .join('\n');
    // The old gate skipped verification whenever the env var was UNSET.
    expect(code).not.toMatch(/if\s*\(\s*!process\.env\.AWS_SNS_VERIFY_SIGNATURES/);
    // The only permitted way to disable verification is the explicit opt-out.
    expect(code).toMatch(/AWS_SNS_VERIFY_SIGNATURES === 'false'/);
  });
});

});
