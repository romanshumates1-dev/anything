/**
 * AGGREGATE / COUNT ORACLE GUARD.
 *
 * /api/regions/estimate and /api/ratelimit both leaked because a COUNT(*) carried no
 * organization predicate. Counts and sums are a distinct vulnerability class: they expose
 * no row data, yet they let a caller INFER another tenant's activity by watching how a
 * number moves when a filter changes. A plain "does the query mention organization_id"
 * check misses them, because these queries often look perfectly scoped otherwise.
 *
 * This guard fails on any aggregate over a tenant-bearing table that has no tenant binding.
 */
import { describe, it, expect } from "vitest";
import { scanSource, readSource } from "./_sourceScan";
import { join, relative } from "node:path";

const ROOT = join(process.cwd(), "src", "app");
const SKIP = new Set(["node_modules", "__tests__", ".next", ".open-next"]);
const BT = String.fromCharCode(96);

const AGG = /\b(COUNT|SUM|AVG|MIN|MAX)\s*\(/i;
const TABLE_RE = /\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)/gi;

// Tables verified to carry no organization_id column.
const NON_TENANT =
  /^(audit_logs|ai_conversations|esign_sessions|credit_transactions|jobs|billing_events|compliance_records|ai_credit_period_usage|usage_ledger|number_pool|dnc_registry|subscription_plans|credit_costs|app_settings|contact_lock|buyer_leads|rate_limit_log)$/i;


function sqlTemplates(src: string): string[] {
  const lines = src.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const idx = lines[i].indexOf("sql" + BT);
    if (idx === -1) {
      i++;
      continue;
    }
    let body = lines[i].slice(idx + 4);
    let j = i;
    while (j < lines.length - 1 && body.indexOf(BT) === -1) {
      j++;
      body += "\n" + lines[j];
    }
    const end = body.indexOf(BT);
    out.push(end === -1 ? body : body.slice(0, end));
    i = j + 1;
  }
  return out;
}

describe("aggregate / count oracle guard", () => {
  const offenders: string[] = [];

  // Test files are intentionally INCLUDED here (fixtures matter to this guard).
  const files = scanSource(ROOT, {
    skipDirs: [...SKIP],
    excludeTests: false,
  });
  for (const f of files) {
    const src = readSource(f);
    if (!/getOrganization|requireSession|authenticateApiKey|requireAdmin/.test(src)) continue;
    if (!/const orgId\s*=|organization\.id|authResult\.organizationId/.test(src)) continue;

    sqlTemplates(src).forEach((t) => {
      if (!AGG.test(t)) return;
      if (!/\bFROM\b/i.test(t)) return; // not a standalone statement
      const tables = [...t.matchAll(TABLE_RE)].map((m) => m[1]).filter((x) => !NON_TENANT.test(x));
      if (tables.length === 0) return;
      const bound =
        /organization_id\s*=/i.test(t) || /\$\{\s*(orgId|organizationId|organization\.id)\s*\}/.test(t);
      if (bound) return;
      offenders.push(
        `${relative(process.cwd(), f).replace(/\\/g, "/")}  tables=[${[...new Set(tables)].join(",")}]  ` +
          t.trim().slice(0, 90).replace(/\s+/g, " ")
      );
    });
  }


  // REVIEWED EXCEPTIONS. Each is an aggregate over a tenant table keyed by a SURROGATE id
  // that the same handler validates against the caller's organization immediately before
  // the aggregate runs. Static analysis cannot see that ordering, so they are enumerated
  // here with the reason they are safe. A list that can never reach zero would leave a
  // permanently-red test, which is worse than an enforced ceiling.
  //
  //   outreach/campaigns/[id]/{stats,contacts,start,complete}
  //     Each first runs SELECT * FROM outreach_campaigns WHERE id = $id AND organization_id
  //     = $org, returns 404 when absent, and only then counts campaign_contacts.
  //   lead-finder/{apollo, sources/[id]/fetch}
  //     source.id comes from a lookup constrained by
  //     (organization_id = $org OR organization_id IS NULL), so the count can only cover
  //     the caller's own source or a shared catalogue source.
  //   lead-finder/plan  (added 2026-09-26 re-review)
  //     The remaining count is over `sourced_leads`, which has NO organization_id
  //     column (migration 006): it is the platform-wide sourcing pool every tenant
  //     draws from, so the figure is platform inventory, not another tenant's data.
  //     The OTHER aggregate in the same handler (stage_transitions) WAS a genuine
  //     cross-tenant leak and is now bound by joining leads on organization_id, so it
  //     no longer appears here.
  //   compliance/tcpa  (added 2026-09-26 re-review)
  //     The count is the TCPA "max 3 contacts per 7 days" frequency cap keyed on the
  //     PHONE the caller is about to contact. A person's contact frequency is
  //     per-person, not per-tenant (opt-out/suppression is already platform-wide), so
  //     binding it to a single org would let a tenant break another tenant's cap by
  //     logging the same number elsewhere. No tenant-owned row is counted or returned;
  //     the leadId inputs to this endpoint are now ownership-checked.
  const REVIEWED = [
    /outreach\/campaigns\/\[id\]\/(stats|contacts|start|complete)\/route\.ts/,
    /lead-finder\/apollo\/route\.ts/,
    /lead-finder\/sources\/\[id\]\/fetch\/route\.ts/,
    /lead-finder\/plan\/route\.ts/,
    /compliance\/tcpa\/route\.ts/,
  ];

  // Ceiling = number of FILES covered by the reviewed patterns (the campaign
  // pattern alone covers four routes). Raising it requires a new rationale above.
  const REVIEWED_BASELINE = 8;

  it('no NEW unbound aggregate may be introduced (count cannot grow)', () => {
    // Baseline is the number of offending FILES covered by the reviewed patterns (the
    // campaign pattern alone covers four routes), not the number of patterns.
    const uniq = [...new Set(offenders)];
    const reviewed = uniq.filter((o) => REVIEWED.some((re) => re.test(o)));
    expect(
      reviewed.length,
      'More files are now matching a reviewed pattern than expected:\n - ' + reviewed.join('\n - ')
    ).toBeLessThanOrEqual(REVIEWED_BASELINE);
    expect(
      uniq.length,
      `Unbound aggregate count grew past the reviewed baseline of ${REVIEWED_BASELINE}:\n - ` +
        uniq.join('\n - ')
    ).toBeLessThanOrEqual(REVIEWED_BASELINE);
  });

  it('every remaining offender is a reviewed surrogate-id exception', () => {
    const unexplained = [...new Set(offenders)].filter((o) => !REVIEWED.some((re) => re.test(o)));
    expect(unexplained, 'Unreviewed unbound aggregates:\n - ' + unexplained.join('\n - ')).toHaveLength(0);
  });

  // REGRESSION: GET /api/ratelimit took a leadId from the query string and counted
  // rate_limit_log rows for it with no organization predicate, letting an admin measure
  // another tenant's per-lead message volume.
  it("REGRESSION: /api/ratelimit never counts another org's per-lead volume", () => {
    const src = readSource(join(process.cwd(), 'src', 'app', 'api', 'ratelimit', 'route.ts'));
    const qs = sqlTemplates(src).filter((t) => /lead_id/i.test(t) && AGG.test(t));
    expect(qs.length).toBeGreaterThan(0);
    for (const q of qs) {
      expect(q, 'unbound per-lead aggregate in ratelimit:\n' + q).toMatch(/organization_id/i);
    }
  });

  // REGRESSION for /api/regions/estimate, the original count-oracle finding.
  it('REGRESSION: /api/regions/estimate never counts leads globally', () => {
    const src = readSource(
    join(process.cwd(), 'src', 'app', 'api', 'regions', 'estimate', 'route.ts')
  );
    const qs = sqlTemplates(src).filter((t) => /FROM\s+leads/i.test(t) && AGG.test(t));
    expect(qs.length).toBeGreaterThan(0);
    for (const q of qs) {
      expect(q, 'unbound leads aggregate in regions/estimate:\n' + q).toMatch(/organization_id/i);
    }
  });
});
