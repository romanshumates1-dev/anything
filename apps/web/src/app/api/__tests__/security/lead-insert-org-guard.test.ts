/**
 * Tenant-column ratchet for lead creation (2026-09-26).
 *
 * `leads.organization_id` is NOT NULL (migration 030). Three routes shipped
 * INSERTs that omitted it — every insert threw on the NOT NULL constraint, so
 * the endpoints 500'd (BREAKAGE_TABLE #35: /api/leads/bulk,
 * /api/lead-finder/create-campaign; same class found again in
 * /api/consent/capture and /api/outreach/keyword-inbound).
 *
 * This static guard walks shipped (non-test) source and fails the build if any
 * `INSERT INTO leads` statement does not mention organization_id in its column
 * list. Reintroducing the bug is therefore impossible without failing CI.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { scanSource, readSource, SRC_ROOT } from './_sourceScan';

const SRC = SRC_ROOT;

describe('lead INSERT tenant ratchet', () => {
  // This walks the whole `src` tree and re-reads every candidate file, so its
  // runtime scales with repository size AND with how much CPU the rest of the
  // suite is using. Under a parallel `vitest run` the read of ~5.8MB across
  // 240+ files stretched past the default 5s budget and this guard failed as a
  // false positive (observed: "Test timed out in 5000ms" at commit 27cae46,
  // while the assertions pass in isolation) - the tenant-isolation coverage it
  // guards was being skipped for a reason that has nothing to do with tenancy.
  //
  // This is the SAME reasoning already recorded in this directory by
  // `synthetic-lead-gate.test.ts` and `swallowed-error.guard.test.ts`, which
  // both carry an identical IO_TIMEOUT_MS budget and the same justification.
  // 30s still fails loudly on a genuine hang while removing the
  // contention-driven false negative, so the guard keeps its teeth - this is a
  // timeout budget, not a suppression. No assertion is relaxed.
  const IO_TIMEOUT_MS = 30_000;

  it('every INSERT INTO leads carries organization_id', () => {
    const offenders: string[] = [];
    const files = scanSource(SRC);

    // A ratchet that scans nothing passes vacuously. Pin the scan size so a
    // future path/glob regression cannot silently disable this guard.
    // 755 files as of 2026-09-26; the floor is deliberately loose.
    expect(files.length, 'source scan collapsed - guard would pass vacuously')
      .toBeGreaterThan(600);

    // Reuse the list captured above rather than re-walking the tree: scanSource
    // is memoized, but calling it twice hid the fact that this test owns the
    // single most expensive scan in the suite.
    for (const file of files) {
      const text = readSource(file);
      let idx = text.indexOf('INSERT INTO leads');
      while (idx !== -1) {
        // The column list and VALUES clause follow within the same statement; look
        // ahead far enough to cover a multi-line column list.
        const window = text.slice(idx, idx + 900);
        const statementEnd = window.indexOf('`');
        const scope = statementEnd === -1 ? window : window.slice(0, statementEnd);
        if (!scope.includes('organization_id')) {
          const line = text.slice(0, idx).split('\n').length;
          offenders.push(`${file.replace(process.cwd(), '')}:${line}`);
        }
        idx = text.indexOf('INSERT INTO leads', idx + 1);
      }
    }

    expect(offenders).toEqual([]);
  }, IO_TIMEOUT_MS);

  it('public funnel and keyword webhook attribute leads to the platform org', () => {
    const consent = readSource(join(SRC, 'app/api/consent/capture/route.ts'));
    expect(consent).toContain('resolvePlatformOrganizationId');

    const keyword = readSource(join(SRC, 'app/api/outreach/keyword-inbound/route.ts'));
    expect(keyword).toContain('resolvePlatformOrganizationId');
  });
});
