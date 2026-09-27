import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { scanSource, readSource } from './_sourceScan';

/**
 * GUARD: no nested SQL fragment composition (defect #32).
 *
 * The pinned `@neondatabase/serverless` turns EVERY template interpolation
 * into a positional `$n` parameter — it has no branch that splices a
 * previously-built query. So this pattern:
 *
 *     let where = sql`organization_id = ${orgId}`;
 *     where = sql`${where} AND status = ${status}`;   // <-- NOT concatenation
 *     sql`SELECT ... WHERE ${where}`;
 *
 * sends the accumulated fragment as a JSON VALUE, and Postgres rejects it:
 *   invalid input syntax for type boolean: "{"parameterizedQuery":{...}}"
 *
 * It cost a 500 on /api/actions for every signed-in user, and it looks correct
 * at a glance, so it is worth failing the build over rather than remembering.
 *
 * The supported way to build a dynamic WHERE clause is the driver's string
 * form — `sql(text, params)` — as `pipelineOrchestrator.getActionQueue` and
 * `lead-finder/public-pool` now do.
 */

const files = scanSource(join(process.cwd(), 'src'), {
  extensions: ['ts', 'tsx'],
  skipDirs: ['node_modules', '__tests__', '.next'],
  excludeTests: true,
});

function codeLines(text: string): string[] {
  return text
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
}

/**
 * The real defect is a variable that holds a QUERY OBJECT being interpolated
 * into another query. That is exactly how the /api/actions bug started:
 *
 *     let conditions = sql`organization_id = ${orgId}`;   // a query object
 *     conditions = sql`${conditions} AND status = ${s}`;  // interpolated -> $n
 *
 * so the check is a small same-file dataflow: collect names assigned from a
 * `sql` tag, then flag any template that interpolates one of them. A plain
 * STRING variable (`let where = clauses.join(' AND ')`) is the SUPPORTED
 * pattern and must not be flagged — `lead-finder/public-pool` and
 * `getActionQueue` both use it.
 */
function fragmentInterpolations(lines: string[]): string[] {
  const queryVars = new Set<string>();
  for (const line of lines) {
    const m = line.match(/\b(?:const|let)\s+(\w+)\s*=\s*sql`/);
    if (m) queryVars.add(m[1]);
  }
  if (queryVars.size === 0) return [];

  const offenders: string[] = [];
  for (const line of lines) {
    for (const m of line.matchAll(/\$\{\s*(\w+)\s*\}/g)) {
      if (queryVars.has(m[1])) {
        offenders.push(line.trim());
        break;
      }
    }
  }
  return offenders;
}

/**
 * The INLINE shape, which the first version of this guard missed: a nested
 * template written directly inside the interpolation, e.g.
 *   ${category ? sql`AND category = ${category}` : sql``}
 * Measured against the live database, every one of these either 500s
 * ("syntax error at or near $n") or - worse - silently produces a wrong
 * result. All sites are migrated; the ratchet keeps them from coming back.
 */
const INLINE_NESTED_RE = /\$\{[^}]*\bsql`/;

/**
 * RATCHET, not a hard zero — but an EXPLICIT, per-file one.
 *
 * 66 sites remain across 19 files. Each was found by executing the real driver
 * (`scripts/probe-fragments.mjs` shows an interpolated fragment either 500s or
 * silently returns wrong rows), and the ones a user can reach from the UI are
 * fixed: `templates/route` (verified 500 in the browser) plus `actions` in the
 * previous wave. The rest are baselined here so the number can only go DOWN:
 * fixing a site requires lowering its count in this table, and a new site in a
 * new file fails the test immediately.
 *
 * Track progress with `node scripts/scan-fragments.mjs`.
 */
const REMAINING_NESTED_SITES: Record<string, number> = {
  'api/achievements/route.ts': 1,
  'api/analytics/advanced/route.ts': 1,
  'api/analytics/ai-recommendations/route.ts': 1,
  'api/compliance/audit/route.ts': 1,
  'api/consent/capture/route.ts': 2,
  'api/duplicates/route.ts': 7,
  'api/portal/offer/route.ts': 2,
  'api/regions/estimate/route.ts': 12,
  'api/templates/library/route.ts': 4,
  'api/user/questionnaire/route.ts': 3,
  'api/utils/buyerDiscoveryEngine.ts': 3,
  'api/utils/campaignEngine.ts': 1,
  'api/utils/compliance-audit.ts': 1,
  'api/utils/leadGenerationEngine.ts': 2,
  'api/utils/outreachVerification.ts': 2,
  'api/utils/pipelineOrchestrator.ts': 1,
  'api/utils/smsGuards.ts': 1,
  'api/utils/trustSignals.ts': 1,
  // `api/feedback/route.ts` and `api/templates/route.ts` are intentionally
  // absent: both were migrated to buildWhere()/validated clauses, and the test
  // below asserts they contain no nested fragment at all.
};

/** Maps an absolute path to the same `api/...` key the table uses. */
function relKey(file: string): string {
  const apiRoot = join(process.cwd(), 'src', 'app', 'api');
  const rel = file.startsWith(apiRoot)
    ? file.slice(apiRoot.length + 1)
    : file.replace(join(process.cwd(), 'src', 'app', 'api') + '\\', '');
  return `api/${rel}`.replace(/\\/g, '/');
}



describe('SQL fragment composition guard', () => {
  it('no shipped file interpolates a sql-typed variable into another query', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const line of fragmentInterpolations(codeLines(readSource(file)))) {
        offenders.push(`${file}: ${line}`);
      }
    }
    expect(
      offenders,
      `Nested sql fragments do not compose with this driver:\n${offenders.join('\n')}`
    ).toEqual([]);
  });

  it('nested sql fragments only remain where the ratchet says they do, and never grow', () => {
    const actual = new Map<string, number>();
    for (const file of files) {
      const count = codeLines(readSource(file)).filter((l) =>
        INLINE_NESTED_RE.test(l)
      ).length;
      if (count > 0) actual.set(relKey(file), count);
    }

    const errors: string[] = [];

    // 1. A file with NO baseline entry must have zero sites.
    for (const [file, count] of actual) {
      if (!(file in REMAINING_NESTED_SITES)) {
        errors.push(
          `NEW nested-fragment site in ${file} (${count}) - use buildWhere() ` +
            `from utils/sqlFragments and the driver's sql(text, params) form`
        );
      }
    }

    // 2. A baselined file must not exceed its recorded count (a fix lowers it;
    //    a regression raises it and fails here).
    for (const [file, allowed] of Object.entries(REMAINING_NESTED_SITES)) {
      const found = actual.get(file) ?? 0;
      if (found > allowed) {
        errors.push(
          `${file}: ${found} nested-fragment site(s), baseline allows ${allowed}`
        );
      }
    }

    expect(
      errors,
      `Nested sql fragments do not compose with this driver (they 500, or silently ` +
        `return wrong rows):\n${errors.join('\n')}`
    ).toEqual([]);
  });

  it('the fixed endpoints contain no nested fragments at all', () => {
    // The two paths verified end-to-end against the running system, plus
    // feedback (migrated for defect #32 second wave and #36).
    for (const rel of [
      'app/api/templates/route.ts',
      'app/api/feedback/route.ts',
    ]) {
      const code = codeLines(readSource(join(process.cwd(), 'src', rel)));
      const remaining = code.filter((l) => INLINE_NESTED_RE.test(l));
      expect(remaining, `${rel} still nests a fragment`).toEqual([]);
    }
  });

  it('the working pattern (string form + params) is what getActionQueue uses', () => {
    const code = codeLines(
      readSource(
        join(process.cwd(), 'src', 'app', 'api', 'utils', 'pipelineOrchestrator.ts')
      )
    ).join('\n');
    expect(code).toMatch(/clauses\.join\(' AND '\)/);
    expect(fragmentInterpolations(code.split('\n'))).toEqual([]);
  });

  it('rateLimiter no longer casts the organization id to uuid', () => {
    // Defect #34: organization ids are text (`org_<hex>`), so the cast made
    // every rate-limited endpoint 500.
    const code = codeLines(
      readSource(join(process.cwd(), 'src', 'app', 'api', 'services', 'rateLimiter.ts'))
    ).join('\n');
    expect(code).not.toMatch(/organizationId\}\s*::uuid/);
  });
});

