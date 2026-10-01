/**
 * GUARD: every route that emits a downloadable file must authorize first.
 *
 * Data-leak audit item (2026-09-30): the six routes that set
 * `Content-Disposition: attachment` were verified by inspection to require
 * admin or session auth plus org scoping, but that is not a property the
 * codebase enforced — a new export added without `requireAdmin` would ship
 * silently. This ratchet closes that gap:
 *
 *   1. Any `route.ts` under `src/app` that emits `Content-Disposition` MUST
 *      reference an authorization mechanism, or the test fails.
 *   2. The known download routes each have a NAMED assertion pinning the exact
 *      guard they must hold (`requireAdmin` for admin exports, session +
 *      `getOrganization` for seller exports), so a weaker substitution fails.
 *   3. The inventory is explicit: a NEW download route fails until it is
 *      reviewed and added here.
 *
 * Which routes and why the bar differs:
 *   admin/exports, admin/exports/finance — platform-wide ledger/org data;
 *     admin only.
 *   outreach/mail/export — generates mail pieces with tracking codes tied to
 *     other orgs' leads if unscoped; admin + org.
 *   debrief (format=csv) — org debrief; admin + org.
 *   leads/export — seller-scoped campaign contacts CSV; session + org.
 *   tax/report — seller earnings CSV; session + org from the session only.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { scanSource, readSource, API_ROOT } from './_sourceScan';

const routes = scanSource(API_ROOT, { onlyFile: 'route.ts' });

/** Any symbol here counts as "this route authorizes the download". */
const AUTH_MARKS = [
  'requireAdmin',
  'requireSession',
  'auth.api.getSession',
  'getOrganization',
  'requireOrgRole',
  'checkAdmin',
];

/**
 * Exact guard each known download route must hold. Keyed by path relative to
 * src/. The value is the minimal symbol set the route MUST contain — a route
 * that drops `getOrganization` for an org-scoped CSV fails even though it
 * still "has auth".
 */
const REQUIRED_GUARDS: Record<string, string[]> = {
  'app/api/admin/exports/route.ts': ['requireAdmin'],
  'app/api/admin/exports/finance/route.ts': ['requireAdmin'],
  'app/api/debrief/route.ts': ['requireAdmin', 'getOrganization'],
  'app/api/leads/export/route.ts': ['auth.api.getSession', 'getOrganization'],
  'app/api/outreach/mail/export/route.ts': ['requireAdmin', 'getOrganization'],
  'app/api/tax/report/route.ts': ['auth.api.getSession', 'getOrganization'],
};

function relKey(file: string): string {
  return file.replace(join(process.cwd(), 'src') + '\\', '').replace(/\\/g, '/');
}

function isDownloadRoute(code: string): boolean {
  return code.includes('Content-Disposition');
}

describe('downloadable-file authorization', () => {
  it('every route that sets Content-Disposition references an auth mechanism', () => {
    const offenders: string[] = [];
    for (const file of routes) {
      const code = readSource(file);
      if (!isDownloadRoute(code)) continue;
      if (!AUTH_MARKS.some((m) => code.includes(m))) {
        offenders.push(`${relKey(file)}: emits a download with no auth reference`);
      }
    }
    expect(offenders, `Downloads must authorize first:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('the known download inventory is exactly as reviewed (no silent additions)', () => {
    const found = routes.filter((f) => isDownloadRoute(readSource(f))).map(relKey).sort();
    const expected = Object.keys(REQUIRED_GUARDS).sort();
    expect(
      found,
      `New download route added without review. ` +
        `Audit it for auth + tenant scoping, then add its guards to REQUIRED_GUARDS. ` +
        `Found: ${found.join(', ')}`
    ).toEqual(expected);
  });

  it('each known download holds its exact guard (a weaker substitution fails)', () => {
    const byRel = new Map(routes.map((f) => [relKey(f), readSource(f)]));
    const failures: string[] = [];
    for (const [rel, marks] of Object.entries(REQUIRED_GUARDS)) {
      const code = byRel.get(rel);
      if (code === undefined) {
        failures.push(`${rel}: route missing from the tree`);
        continue;
      }
      for (const mark of marks) {
        if (!code.includes(mark)) failures.push(`${rel}: missing required guard '${mark}'`);
      }
    }
    expect(failures, `Download guards weakened:\n${failures.join('\n')}`).toEqual([]);
  });
});
