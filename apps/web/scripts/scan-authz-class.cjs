// AUTHZ CLASS SCAN: "tenant resolved but never applied".
//
// Findings #8 (analytics/ai-recommendations) and the /api/ratelimit oracle share one
// shape: the handler calls getOrganization() so it LOOKS authorized, and the result is
// either dropped or never reaches a WHERE clause. A presence check for organization_id
// cannot see this, which is why it kept recurring. This reports every handler that
// resolves a tenant but has no tenant binding in any statement.
const fs=require("fs"),path=require("path");
const ROOT=path.join(process.cwd(),"src","app");
const SKIP=new Set(["node_modules","__tests__",".next",".open-next"]);
const BT=String.fromCharCode(96);
const T=/\b(?:FROM|JOIN|UPDATE|INTO)\s+([a-z_][a-z0-9_]*)/gi;
const NON_TENANT=/^(audit_logs|credit_transactions|jobs|billing_events|compliance_records|ai_credit_period_usage|usage_ledger|number_pool|dnc_registry|subscription_plans|credit_costs|app_settings|contact_lock|buyer_leads|market_config|regions|zip_codes|states|counties|rate_limit_log|lead_sources|sourced_leads|stripe_events|signups|templates|dispositions|zip_region|regions_by_zip)$/i;
function walk(d,o=[]){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(SKIP.has(e.name))continue;const p=path.join(d,e.name);if(e.isDirectory())walk(p,o);else if(/\.tsx?$/.test(e.name))o.push(p);}return o;}
function tpl(src){const L=src.split(/\r?\n/);const o=[];let i=0;while(i<L.length){const x=L[i].indexOf("sql"+BT);if(x===-1){i++;continue;}let b=L[i].slice(x+4);let j=i;while(j<L.length-1&&b.indexOf(BT)===-1){j++;b+="\n"+L[j];}const e=b.indexOf(BT);o.push(e===-1?b:b.slice(0,e));i=j+1;}return o;}
const rows=[];
for(const f of walk(ROOT)){
  const s=fs.readFileSync(f,"utf8");
  const resolves=/getOrganization\(\)|organization\.id|organizationId|orgId/.test(s);
  if(!resolves)continue;
  const ts=tpl(s);
  if(!ts.length)continue;
  // tables actually touched that are tenant-bearing
  const tables=[...new Set(ts.flatMap(t=>[...t.matchAll(T)].map(m=>m[1])))] .filter(x=>!NON_TENANT.test(x));
  if(!tables.length)continue;
  // is ANY statement tenant-bound?
  const bound=ts.some(t=>/organization_id\s*=/i.test(t));
  if(bound)continue;
  // does the handler even read a tenant id into a variable?
  const usesVar=/const\s+(orgId|organizationId|organization)\b/.test(s);
  if(!usesVar)continue;
  const rel=path.relative(process.cwd(),f).replace(/\\/g,"/");
  rows.push({rel,tables:tables.slice(0,4).join(","),n:ts.length});
}
console.log("TENANT RESOLVED BUT NEVER APPLIED: "+rows.length+"\n");
const byF=new Map();
for(const r of rows){if(!byF.has(r.rel))byF.set(r.rel,r);}
[...byF.values()].sort((a,b)=>b.n-a.n).forEach(r=>console.log("  "+r.rel+"  tables=["+r.tables+"]  stmts="+r.n));
