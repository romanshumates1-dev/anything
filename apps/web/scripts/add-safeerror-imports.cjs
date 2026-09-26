const fs=require("fs");
const files=["src/app/api/payments/buyer-payment/route.ts","src/app/api/payments/charge-assignment/route.ts","src/app/api/payments/stripe/route.ts"];
for(const rel of files){
  let s=fs.readFileSync(rel,"utf8");
  if(/safeErrorResponse/.test(s)){console.log("already: "+rel);continue;}
  const lines=s.split(/\r?\n/);
  let last=-1;
  lines.forEach((l,i)=>{ if(/^import\b/.test(l)){ let j=i; while(j<lines.length && !/;\s*$/.test(lines[j])) j++; last=j; } });
  lines.splice(last+1,0,"import { safeErrorResponse } from '@/app/api/utils/safeError';");
  fs.writeFileSync(rel,lines.join("\n"));
  console.log("import added: "+rel+" at line "+(last+2));
}
