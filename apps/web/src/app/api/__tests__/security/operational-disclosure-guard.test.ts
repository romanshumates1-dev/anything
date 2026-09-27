/**
 * OPERATIONAL-ROUTE DISCLOSURE GUARD (2026-09-27).
 *
 * CLASS OF DEFECT
 * A live unauthenticated sweep found `GET /api/system/cron` returning 200 with
 * the complete internal job roster and schedule - task names such as
 * `ghost-sweep`, `resurrection`, `dead-letter-alert`, `buyer-pipeline` and
 * their exact cadence - while the `POST` that actually RUNS a task was
 * correctly gated on `x-cron-secret`.
 *
 * Protecting the action while publishing the blueprint is the same bug. It
 * hands an attacker the operational map: which subsystems exist, how often they
 * run (so when is the system quietest), and the internal vocabulary needed to
 * guess sibling endpoints.
 *
 * WHY THE EXISTING RATCHET MISSED IT
 * `secret-compare-guard.test.ts` asserted the cron file CONTAINS a
 * `timingSafeSecretEqual(` call. It never checked that EVERY exported handler
 * in the file is guarded. A file can be half-protected and pass forever. This
 * guard checks per-handler instead: each exported method must contain a secret
 * comparison, a session/admin gate, or an explicit documented exemption.
 */
import { describe, expect, it } from 'vitest';
import { scanSource, readSource, SRC_ROOT } from './_sourceScan';
import { join } from 'node:path';

/** Split a source file into its `export async function X` blocks. */
function handlers(src: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const re = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(/g;
  const starts: { name: string; index: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) starts.push({ name: m[1], index: m.index });
  starts.forEach((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index : src.length;
    out.push({ name: s.name, body: src.slice(s.index, end) });
  });
  return out;
}

/** A handler is protected if it performs any recognized gate. */
function isGuarded(body: string): boolean {
  return (
    /timingSafeSecretEqual\(/.test(body) ||
    /getSession\(/.test(body) ||
    /requireAdmin\(/.test(body) ||
    /requireAuth\(/.test(body) ||
    /authenticateApiKey\(/.test(body) ||
    /validateTwilioSignature\(/.test(body) ||
    /verifyStripeSignature|stripe\.webhooks\.constructEvent/.test(body) ||
    /devOnlyGuard\(/.test(body) ||
    /CRON_SECRET|SMS_WEBHOOK_SECRET|ESIGN_WEBHOOK_SECRET/.test(body)
  );
}

describe('operational-route disclosure guard', () => {
  it('scans the system routes', () => {
    const files = scanSource(join(SRC_ROOT, 'app', 'api', 'system'), {
      onlyFile: 'route.ts',
    });
    // Vacuous-pass protection: the scanner must actually be finding routes.
    expect(files.length, 'system route scan collapsed').toBeGreaterThan(3);
  });

  it('NO handler in /api/system/cron is reachable without the cron secret', () => {
    // The specific regression: GET was public while POST was gated.
    const file = join(SRC_ROOT, 'app', 'api', 'system', 'cron', 'route.ts');
    const hs = handlers(readSource(file));
    expect(hs.length, 'cron route handlers not found').toBeGreaterThanOrEqual(2);
    const unguarded = hs.filter((h) => !isGuarded(h.body)).map((h) => h.name);
    expect(
      unguarded,
      'these cron handlers run without the x-cron-secret gate and disclose the job map'
    ).toEqual([]);
  });

  it('no /api/system route handler is unguarded without a documented exemption', () => {
    const files = scanSource(join(SRC_ROOT, 'app', 'api', 'system'), {
      onlyFile: 'route.ts',
    });
    const offenders: string[] = [];
    for (const file of files) {
      const rel = file.replace(join(SRC_ROOT, 'app', 'api', 'system'), 'system');
      for (const h of handlers(readSource(file))) {
        if (isGuarded(h.body)) continue;
        // The health probe is intentionally public, but only for liveness. It
        // must not publish version/uptime/service detail without the ops
        // secret - which is what the opsSecret gate provides.
        if (/health[\\/]route\.ts$/.test(file) && h.name === 'GET') {
          if (/opsSecret/.test(h.body)) continue;
        }
        offenders.push(`${rel} ${h.name}`);
      }
    }
    expect(
      offenders,
      `unguarded system handlers (add a gate, or document why public is safe):\n${offenders.join('\n')}`
    ).toEqual([]);
  });

  it('the public health payload carries no version, uptime or service topology', () => {
    // A ratchet on the RESPONSE SHAPE, not just the auth: even a future edit
    // that keeps the handler public must not reintroduce reconnaissance data.
    const src = readSource(join(SRC_ROOT, 'app', 'api', 'system', 'health', 'route.ts'));
    const publicBlock = src.slice(src.indexOf('const base = {'), src.indexOf('const payload'));
    expect(publicBlock).not.toMatch(/version/);
    expect(publicBlock).not.toMatch(/uptime/);
    expect(publicBlock).not.toMatch(/services/);
    // ...and the richer payload must be behind the ops gate.
    expect(src).toMatch(/isOps\s*\?/);
  });
});
