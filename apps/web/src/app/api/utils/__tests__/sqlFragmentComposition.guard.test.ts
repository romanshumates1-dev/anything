// Defect 32 guard: no nested sql template fragments.
//
// The neon serverless driver turns EVERY template interpolation into a
// positional parameter. It has no branch that splices a previously-built
// query, so assigning a standalone sql template to a variable and then
// interpolating it into an outer query never worked and silently does the
// wrong thing (the fragment arrives as a JSON blob, and Postgres rejects it
// with a positional-parameter syntax error).
//
// This exact defect shipped in crmAnalyticsEngine, where three dateFilter
// fragments were interpolated into nine outer queries. It broke
// GET /api/analytics/crm with HTTP 500 on the live worker, found 2026-10-05
// by an authenticated page probe.
//
// sql.ts documents this as defect 32 and names a guard file that was never
// actually written. This is that guard. If anyone reintroduces the pattern,
// this fails the build.
//
// The rule: a standalone sql template MUST NEVER be assigned to a variable and
// later interpolated into another sql template. Dynamic WHERE pieces go in as
// scalar interpolations, exactly as getRegionalAnalytics already does. That is
// safe because the driver parameterises every scalar, so no user input is ever
// concatenated.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ENGINE = join(process.cwd(), 'src', 'app', 'api', 'utils', 'crmAnalyticsEngine.ts');

function source(): string {
  return readFileSync(ENGINE, 'utf8');
}

describe('defect 32 - no nested sql fragments', () => {
  it('assigns no standalone sql template to a fragment variable', () => {
    // A const or let assigned from a sql template on a REAL code line is the
    // shape of every historical violation: the fragment is built once, then
    // interpolated into N outer queries, all of which break. Comment lines are
    // excluded so prose that names the pattern does not trip this.
    const hits = source()
      .split('\n')
      .map((line, index) => ({ line, index: index + 1 }))
      .filter(({ line }) => {
        const text = line.trim();
        if (text.startsWith('//') || text.startsWith('*')) return false;
        // A FRAGMENT is assigned WITHOUT await on its declaration line (its
        // query is never run — it is stored for later interpolation). An outer
        // query is always `const x = await sql...`. Requiring the absence of
        // `await` separates the broken pattern from every legitimate query.
        if (/\bawait\b/.test(line)) return false;
        return /^\s*(const|let)\s+\w+\s*=/.test(line) && line.includes('sql`');
      });
    expect(hits.map((h) => `${h.index}: ${h.line.trim()}`)).toEqual([]);
  });

  it('interpolates no bare identifier fragment without its own binding', () => {
    // The one legitimate placeholder shape inside these queries is a scalar
    // value the driver can parameterise (organizationId, startDate, endDate).
    // A dateFilter-style identifier is a nested query, not a scalar.
    const fragments = ['dateFilter', 'whereClause', 'filterSql', 'whereFragment'];
    for (const name of fragments) {
      const present = source().includes('${' + name + '}');
      expect(present, 'nested fragment ' + name + ' must not be interpolated').toBe(false);
    }
  });
});