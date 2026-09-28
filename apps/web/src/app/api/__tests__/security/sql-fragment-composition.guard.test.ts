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
 * HARD ZERO — the ratchet is retired.
 *
 * It began at 66 sites / 19 files and every one has been migrated. The last 46
 * were each triaged and fixed, not baselined: every reachable site turned out to
 * be a real 500 or a silently wrong result, so there was nothing safe to leave
 * behind. Notably, `campaignEngine` and `pipelineOrchestrator` had their fragment
 * in an INSERT COLUMN LIST, which is a syntax error in BOTH ternary branches —
 * adding any lead to a campaign always threw.
 *
 * The last four (`user/questionnaire`, `achievements`) were the subtle ones:
 * `${cond ? sql`now()` : null}` inside a VALUES list. `null` binds fine, but the
 * `sql`now()`` branch is still a fragment, so it bound the marker JSON into a
 * timestamptz column — questionnaire completion and achievement unlocking both
 * 500'd. They now bind a `Date`.
 *
 * Reintroducing ANY site fails this test. Track with
 * `node scripts/scan-fragments.mjs`, which must print 0.
 */
const REMAINING_NESTED_SITES: Record<string, number> = {};

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

  /**
   * GUARD: `sql.unsafe()` must never be interpolated into a tagged template
   * (defect #37).
   *
   * `utils/sql.ts` implements `unsafe` as `() => ({ __unsafeSql: text })`, but
   * the pinned driver has no knowledge of that marker. Executed against the live
   * database (scripts/verify-sql-fixes.mjs, case 4), the marker is sent as a
   * VALUE:
   *
   *     SELECT $1  ->  {"__unsafeSql":"1"}
   *
   * so `SET ${sql.unsafe(clauses)}` became `SET $1, updated_at = NOW()` - a
   * syntax error. That silently broke PATCH on both the pipeline config and the
   * negotiation config: saving either one always returned 500. The API is a
   * trap, so it is banned rather than merely unused.
   */
  it('no shipped file interpolates sql.unsafe() into a tagged template', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const line of codeLines(readSource(file))) {
        if (/\$\{[^}]*\bsql\.unsafe\(/.test(line)) {
          offenders.push(`${file}: ${line.trim()}`);
        }
      }
    }
    expect(
      offenders,
      `sql.unsafe() returns a marker object the driver binds as a VALUE, so it ` +
        `cannot splice text inside a tagged template (it becomes SET $1). Use the ` +
        `driver's sql(text, params) string form instead:\n${offenders.join('\n')}`
    ).toEqual([]);
  });

  it('the two config PATCH routes build their SET clause with the string form', () => {
    for (const rel of [
      'app/api/utils/pipelineOrchestrator.ts',
      'app/api/negotiation/config/route.ts',
    ]) {
      const code = codeLines(readSource(join(process.cwd(), 'src', rel))).join('\n');
      expect(code, `${rel} must not use sql.unsafe`).not.toMatch(/sql\.unsafe\(/);
      expect(code, `${rel} must bind values via the string form`).toMatch(
        /\$\{values\.length \+ 1\}/
      );
    }
  });
});

