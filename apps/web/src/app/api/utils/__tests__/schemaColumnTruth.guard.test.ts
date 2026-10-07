// Schema-truth guards: a query must reference columns/tables that EXIST on the
// live database.
//
// WHY THIS EXISTS (found 2026-10-06, authenticated page probe)
// -----------------------------------------------------------
// GET /api/analytics/crm returned 500 on the deployed worker with:
//
//   * `NeonDbError: column c.lead_id does not exist`
//     The contracts <-> leads link is `contracts.seller_lead_id (text)` joined
//     to `leads.id (integer)` via `c.seller_lead_id = l.id::text` — exactly as
//     src/app/api/analytics/advanced/route.ts has always done it. Six join sites
//     (5 in crmAnalyticsEngine, 1 in analytics/attribution) used a `lead_id`
//     column that has never existed on contracts. Nothing typed the SQL against
//     the real schema, and mocked route tests never execute it, so the wrong
//     column name survived every green test run.
//
//   * `NeonDbError: column "opened_at" does not exist`
//     message_events has NO open-tracking column — not in migration 001, not in
//     095 (which adds the ledger columns), not anywhere in db/migrations. The
//     email stats query filtered on it regardless, so the outreach view 500'd.
//
// THE RULE
// --------
//  1. Inside a sql template that JOINs `contracts`, the lead link must be
//     `seller_lead_id` — a bare `<alias>.lead_id` is the phantom column.
//  2. Inside a sql template that reads `message_events`, `opened_at` must not
//     appear — the column does not exist.
//  3. Inside a sql template that reads `leads`, `<alias>.zip_code` must not
//     appear — the column is `zip`. (Found the same day: the regional zip view
//     500'd only for `?view=regional&groupBy=zipCode`, which the default probe
//     never requests — parameter-dependent defects need parameterised probes.)
//
// Both rules are static: they scan real source (tests excluded) so a broken
// query fails the build instead of a production 500.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      walk(path, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.(ts|tsx)$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

/** Every `sql`...`` template literal in the file (the tagged-template shape). */
function sqlTemplates(source: string): string[] {
  const templates: string[] = [];
  const re = /sql`([\s\S]*?)`/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) templates.push(match[1]);
  return templates;
}

/** The schema-truth rules, run over one source file's contents. */
function detect(rel: string, source: string): string[] {
  const violations: string[] = [];
  for (const template of sqlTemplates(source)) {
    // Rule 1: a query that JOINs `contracts` must link leads through the REAL
    // column `seller_lead_id`. Match on the CONTRACTS ALIAS only — other tables
    // in the same query legitimately have their own lead_id (e.g.
    // campaign_lead_queue.lead_id), and CTE aliases like `l.id as lead_id` are
    // output labels, not column references.
    const join = /JOIN\s+contracts\s+([A-Za-z_]\w*)/i.exec(template);
    if (join) {
      const alias = join[1];
      const phantom = new RegExp(`\\b${alias}\\.lead_id\\b`);
      if (phantom.test(template)) {
        violations.push(`${rel}: JOIN contracts as ${alias} references phantom column ${alias}.lead_id (use ${alias}.seller_lead_id = l.id::text)`);
      }
    }
    if (/FROM\s+message_events\b/i.test(template) && /\bopened_at\b/i.test(template)) {
      violations.push(`${rel}: query over message_events references opened_at (column does not exist)`);
    }
    // Rule 3: `leads` has `zip`, not `zip_code` (live schema 2026-10-06). The
    // regional zip view filtered on `l.zip_code` and 500'd only when the client
    // asked for groupBy=zipCode, which the default probe never did.
    const leadsJoin = /(?:FROM|JOIN)\s+leads\s+([A-Za-z_]\w*)/i.exec(template);
    if (leadsJoin) {
      const alias = leadsJoin[1];
      if (new RegExp(`\\b${alias}\\.zip_code\\b`).test(template)) {
        violations.push(`${rel}: leads table referenced as ${alias}.zip_code (real column: ${alias}.zip)`);
      }
    }
  }
  return violations;
}

const violations: string[] = [];
for (const file of walk(ROOT)) {
  violations.push(...detect(file.slice(ROOT.length + 1), readFileSync(file, 'utf8')));
}

describe('schema truth - queries reference columns that exist', () => {
  it('never joins contracts on the phantom lead_id column', () => {
    const hits = violations.filter((v) => v.includes('phantom column'));
    expect(hits).toEqual([]);
  });

  it('never reads opened_at from message_events', () => {
    const hits = violations.filter((v) => v.includes('opened_at'));
    expect(hits).toEqual([]);
  });

  it('never reads zip_code from leads', () => {
    const hits = violations.filter((v) => v.includes('zip_code'));
    expect(hits).toEqual([]);
  });

  it('flags the exact defects that shipped (regression samples)', () => {
    // The detector must still catch the production 500 shapes even though the
    // real files are now fixed — otherwise the tree scan above is vacuous.
    const bad = detect('sample.ts', `
      const a = sql\`SELECT * FROM leads l LEFT JOIN contracts c ON c.lead_id = l.id WHERE l.organization_id = \${o}\`;
      const b = sql\`SELECT COUNT(*) FILTER (WHERE opened_at IS NOT NULL) FROM message_events WHERE channel = 'email'\`;
      const c = sql\`SELECT l.zip_code as region FROM leads l WHERE l.zip_code IS NOT NULL\`;
    `);
    expect(bad).toHaveLength(3);
    expect(bad[0]).toContain('phantom column');
    expect(bad[1]).toContain('opened_at');
    expect(bad[2]).toContain('zip_code');
  });

  it('does not flag legitimate shapes that share the keywords', () => {
    const good = detect('sample.ts', `
      const a = sql\`SELECT * FROM leads l LEFT JOIN contracts c ON c.seller_lead_id = l.id::text\`;
      const b = sql\`SELECT COUNT(DISTINCT clq.lead_id), l.id as lead_id FROM campaign_lead_queue clq JOIN leads l ON l.id = clq.lead_id LEFT JOIN contracts c ON c.seller_lead_id = l.id::text\`;
      const c = sql\`SELECT COUNT(*) FROM message_events WHERE status = 'delivered'\`;
      const d = sql\`SELECT p.zip_code FROM public_lead_pool p WHERE p.zip_code IS NOT NULL\`;
    `);
    expect(good).toEqual([]);
  });

  it('the scanner itself sees the known violations when they exist', () => {
    // Sanity: the scan ran over a real tree (guards a silent zero-file walk).
    expect(walk(ROOT).length).toBeGreaterThan(50);
  });
});