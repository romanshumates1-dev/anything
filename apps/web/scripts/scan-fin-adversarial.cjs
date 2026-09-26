// FINANCIAL ADVERSARIAL CLASS SCAN
//
// Four classes that corrupt money in a SaaS like this:
//  A. CLIENT-AUTHORITATIVE VALUE  - a price/amount/credits/plan read from the request
//     instead of the database. Attacker sets amount=1 and buys a year of Pro.
//  B. NO IDEMPOTENCY              - retry, double-click, or webhook redelivery applies a
//     financial effect twice.
//  C. WEAK/NONE WEBHOOK VALIDATION - anyone can POST a "payment succeeded" event.
//  D. NON-ATOMIC LEDGER           - balance read and debit are separate statements, so two
//     concurrent requests both pass the check and drive the balance negative.
const fs=require("fs"),path=require("path");
const ROOT=path.join(process.cwd(),"src","app","api");
const SKIP=new Set(["node_modules","__tests__",".next"]);
const FIN=/(payment|billing|stripe|subscription|credit|payout|withdraw|earning|refund|charge|invoice|checkout|ledger|tax|balance|plan)/i;
const MONEY=/(amount|price|total|cents|subtotal|unit_price|quantity|qty|credits|ai_credits|balance|value|fee|tax|rate|discount|plan_id|planId|tier|package)/i;
function walk(d,o=[]){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(SKIP.has(e.name))continue;const p=path.join(d,e.name);if(e.isDirectory())walk(p,o);else if(/\.tsx?$/.test(e.name))o.push(p);}return o;}
const out={clientAuthoritative:[],noIdempotency:[],weakWebhook:[],nonAtomic:[]};
for(const f of walk(ROOT)){
  const rel=path.relative(process.cwd(),f).replace(/\\/g,"/");
  if(!FIN.test(rel)&&!FIN.test(f))continue;
  const s=fs.readFileSync(f,"utf8");
  // A: destructured money-ish field from a request body/params
  const destruct=[];
  for(const m of s.matchAll(/const\s*\{([^}]+)\}\s*=\s*await\s+(req\.json\(\)|request\.json\(\))/g)){
    for(const nm of m[1].split(",")){
      const f2=nm.split(":")[0].trim();
      if(MONEY.test(f2))destruct.push(f2);
    }
  }
  for(const nm of destruct){
    if(!/amount|price|total|cents|quantity|qty|credits|balance|value|fee|tax|rate|discount/i.test(nm))continue;
    out.clientAuthoritative.push({rel,field:nm});
  }
  // B: webhook / financial POST handler with no idempotency guard
  if(/export async function POST/.test(s)&&/(webhook|checkout|charge|purchase|payment|withdraw|payout)/i.test(rel)){
    if(!/idempot/i.test(s)&&!/(payment_intent|event\.id|evt\.id|insert.*ON CONFLICT|ON CONFLICT)/i.test(s))
      out.noIdempotency.push(rel);
  }
  // C: webhook handler lacking signature verification
  if(/webhook/i.test(rel)&&/export async function POST/.test(s)){
    if(!/(constructEvent|stripe\.webhooks|verifySignature|signature|svix|webhookSecret|WEBHOOK_SECRET|timingSafeEqual)/i.test(s))
      out.weakWebhook.push(rel);
  }
  // D: balance checked then decremented in separate statements
  if(/(balance|credit_balance|available_balance)/i.test(s)&&/UPDATE/i.test(s)){
    const selects=(s.match(/SELECT[\s\S]{0,400}?balance/gi)||[]).length;
    const updates=(s.match(/UPDATE[\s\S]{0,120}?SET[\s\S]{0,160}?balance\s*=/gi)||[]).length;
    if(selects>0&&updates>0)out.nonAtomic.push(rel+"  (reads="+selects+",writes="+updates+")");
  }
}
const P=(k,a)=>{console.log("\n=== "+k+" ("+a.length+") ===");[...new Set(a)].forEach(x=>console.log("  "+(typeof x==="string"?x:x.rel+"  field="+x.field)));};
console.log("FINANCIAL ADVERSARIAL CLASS SCAN");
P("A. CLIENT-AUTHORITATIVE MONEY FIELDS",out.clientAuthoritative);
P("B. FINANCIAL POST WITHOUT IDEMPOTENCY GUARD",out.noIdempotency);
P("C. WEBHOOK WITHOUT VISIBLE SIGNATURE VERIFICATION",out.weakWebhook);
P("D. POSSIBLY NON-ATOMIC BALANCE READ+WRITE",out.nonAtomic);
