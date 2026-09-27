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
  it('every INSERT INTO leads carries organization_id', () => {
    const offenders: string[] = [];
    const files = scanSource(SRC);

    // A ratchet that scans nothing passes vacuously. Pin the scan size so a
    // future path/glob regression cannot silently disable this guard.
    // 755 files as of 2026-09-26; the floor is deliberately loose.
    expect(files.length, 'source scan collapsed - guard would pass vacuously')
      .toBeGreaterThan(600);

    for (const file of scanSource(SRC)) {
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
  });

  it('public funnel and keyword webhook attribute leads to the platform org', () => {
    const consent = readSource(join(SRC, 'app/api/consent/capture/route.ts'));
    expect(consent).toContain('resolvePlatformOrganizationId');

    const keyword = readSource(join(SRC, 'app/api/outreach/keyword-inbound/route.ts'));
    expect(keyword).toContain('resolvePlatformOrganizationId');
  });
});
