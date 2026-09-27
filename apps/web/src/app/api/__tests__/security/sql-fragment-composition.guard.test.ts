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

