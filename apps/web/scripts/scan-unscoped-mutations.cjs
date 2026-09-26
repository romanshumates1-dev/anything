// CLASS: state-changing statements with no tenant predicate.
//
// dealOutcomes.ts had `UPDATE campaign_contacts ... WHERE id = ${contactId}` and the
// e-sign PUT had `UPDATE esign_envelopes ... WHERE id = ${envelopeId}`. Both are the same
// shape: a MUTATION keyed only by a client-supplied id. Reads leak data; writes corrupt
// state, so this class is strictly worse. UPDATEs and DELETEs are separated from SELECTs
// because a SELECT without a tenant predicate may be legitimately global (a config or
// shared catalogue table), while a mutation without one is a cross-tenant write.
const fs=require("fs"),path=require("path");
const ROOT=path.join(process.cwd(),"src","app");
const SKIP=new Set(["node_modules","__tests__",".next",".open-next"]);
const BT=String.fromCharCode(96);
// Tables that legitimately carry no organization_id.
const GLOBAL_OK=/^(organizations|organization_members|organization_subscriptions|plans|subscription_plans|app_settings|schema_migrations|audit_logs|jobs|credit_transactions|billing_events|rate_limit_log|ai_credit_period_usage|usage_ledger|contact_lock|regions|zip_codes|states|counties|properties|property_comps|test_phone_numbers|suppression_list|email_domain_policies|webhook_events|number_pool)$/i;
function walk(d,o=[]){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(SKIP.has(e.name))continue;const p=path.join(d,e.name);if(e.isDirectory())walk(p,o);else if(/\.tsx?$/.test(e.name))o.push(p);}return o;}
function tpl(src){const L=src.split(/\r?\n/);const o=[];let i=0;while(i<L.length){const x=L[i].indexOf("sql"+BT);if(x===-1){i++;continue;}let b=L[i].slice(x+4);let j=i;while(j<L.length-1&&b.indexOf(BT)===-1){j++;b+="\n"+L[j];}const e=b.indexOf(BT);o.push(e===-1?b:b.slice(0,e));i=j+1;}return o;}
const MUT=/^\s*(UPDATE|DELETE\s+FROM)\s+([a-z_][a-z0-9_]*)/i;
const rows=[];
for(const f of walk(ROOT)){
  const s=fs.readFileSync(f,"utf8");
  if(!/getOrganization|requireSession|requireAdmin|auth\.api\.getSession/.test(s))continue;
  tpl(s).forEach(t=>{
    const m=t.match(MUT); if(!m)return;
    const [,verb,table]=m;
    if(GLOBAL_OK.test(table))return;
    if(/organization_id\s*=/i.test(t))return;
    // Is the handler even aware of a tenant? If not, it may still be an internal job.
    const tenantAware=/organization|orgId/.test(s);
    if(!tenantAware)return;
    rows.push({rel:path.relative(process.cwd(),f).replace(/\\/g,"/"),verb:verb.toUpperCase(),table,
      head:t.trim().replace(/\s+/g," ").slice(0,100)});
  });
}
const byF=new Map();
for(const r of rows){const k=r.rel+"|"+r.verb+"|"+r.table; if(!byF.has(k))byF.set(k,r);}
console.log("UNSCOPED MUTATIONS (tenant-aware handlers): "+byF.size+"\n");
[...byF.values()].forEach(r=>console.log("  "+r.verb+" "+r.table+"\n     "+r.rel+"\n     "+r.head+"\n"));
