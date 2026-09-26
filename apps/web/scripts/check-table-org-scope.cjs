// Which tables carry organization_id, counting both CREATE TABLE and ALTER TABLE ADD COLUMN.
const fs = require('fs');
const path = require('path');

const MIG = path.join(process.cwd(), 'db', 'migrations');
const files = fs.readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();

const TABLES = [
  'campaign_lead_queue', 'campaigns', 'outreach_campaigns', 'leads', 'message_events',
  'contracts', 'campaign_contacts', 'buyer_assignments', 'buyers', 'compliance_records',
  'ai_conversations', 'contacts', 'jobs', 'credit_balances',
];

const has = new Set();
const src0 = [];

for (const f of files) {
  const sql = fs.readFileSync(path.join(MIG, f), 'utf8');
  // 1) CREATE TABLE ... ( body );
  const cre = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\n\s*\)\s*;/gi;
  let m;
  while ((m = cre.exec(sql))) {
    if (/organization_id/i.test(m[2])) has.add(m[1].toLowerCase());
  }
  // 2) ALTER TABLE <name> ADD [COLUMN] organization_id ...
  const alt = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?"?(\w+)"?\s+ADD\s+(?:COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?)?"?organization_id"?/gi;
  while ((m = alt.exec(sql))) {
    has.add(m[1].toLowerCase());
  }
}

console.log('TABLE'.padEnd(24), 'organization_id');
console.log('-'.repeat(46));
for (const t of TABLES) {
  console.log(t.padEnd(24), has.has(t) ? 'YES' : 'no');
}
