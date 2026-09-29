// AGGREGATE / COUNT ORACLE SWEEP
//
// /api/regions/estimate leaked because a COUNT(*) had no organization predicate. Counts,
// sums and averages are a special class: even when they expose no row data, they let a
// caller INFER another tenant's activity by observing how a number changes with a filter.
// This finds every aggregate statement in the app and reports the ones with no tenant
// binding at all.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(process.cwd(), "src", "app");
const SKIP = new Set(["node_modules", "__tests__", ".next", ".open-next"]);
const BT = String.fromCharCode(96);

const AGG = /\b(COUNT|SUM|AVG|MIN|MAX)\s*\(/i;
const TABLES = /\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)/gi;

function walk(d, o = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, o);
    else if (/\.tsx?$/.test(e.name)) o.push(p);
  }
  return o;
}

function sqlTemplates(src) {
  const lines = src.split(/\r?\n/);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const idx = lines[i].indexOf("sql" + BT);
    if (idx === -1) { i++; continue; }
    let body = lines[i].slice(idx + 4);
    let j = i;
    while (j < lines.length - 1 && body.indexOf(BT) === -1) { j++; body += "\n" + lines[j]; }
    const end = body.indexOf(BT);
    out.push(end === -1 ? body : body.slice(0, end));
    i = j + 1;
  }
  return out;
}

// Tables with no organization_id column (verified against db/migrations).
const NON_TENANT = /^(audit_logs|ai_conversations|esign_sessions|credit_transactions|jobs|billing_events|compliance_records|ai_credit_period_usage|usage_ledger|number_pool|dnc_registry|subscription_plans|credit_costs|app_settings|contact_lock|buyer_leads|market_config|regions|zip_codes|states|counties)$/i;

const rows = [];
for (const f of walk(ROOT)) {
  const src = fs.readFileSync(f, "utf8");
  if (!/getOrganization|requireSession|authenticateApiKey|requireAdmin/.test(src)) continue;
  const resolvesOrg = /const orgId\s*=|organization\.id|authResult\.organizationId/.test(src);
  if (!resolvesOrg) continue;
  sqlTemplates(src).forEach((t, idx) => {
    if (!AGG.test(t)) return;
    if (!/\bFROM\b/i.test(t)) return;
    const tables = [...t.matchAll(TABLES)].map((m) => m[1]);
    const tenantTables = tables.filter((x) => !NON_TENANT.test(x));
    if (tenantTables.length === 0) return;
    // Explicit, statement-level exemption: a platform-wide counter that must NOT
    // be tenant-bound (e.g. the TCPA per-phone frequency limit, which protects the
    // consumer no matter which tenant dialed). The marker is a SQL comment inside
    // the statement, so the reason sits next to the exemption it justifies.
    if (/scanner-allow:\s*platform-wide/.test(t)) return;
    const bound = /organization_id\s*=/i.test(t) || /\$\{\s*(orgId|organizationId|organization\.id)\s*\}/.test(t);
    if (bound) return;
    const rel = path.relative(process.cwd(), f).replace(/\\/g, "/");
    rows.push({ rel, idx: idx + 1, tables: [...new Set(tenantTables)].join(","), head: t.trim().slice(0, 90).replace(/\s+/g, " ") });
  });
}

console.log("UNBOUND AGGREGATE QUERIES: " + rows.length + "\n");
const byFile = new Map();
for (const r of rows) { if (!byFile.has(r.rel)) byFile.set(r.rel, []); byFile.get(r.rel).push(r); }
for (const [f, items] of [...byFile.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${f}  (${items.length})`);
  items.forEach((i) => console.log(`    tables=[${i.tables}]  ${i.head}`));
  console.log("");
}
