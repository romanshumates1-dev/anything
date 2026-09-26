// List every `sql` tagged template in a route file, with its line number and the
// tables it touches, so tenant scoping can be applied accurately.
const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src', 'app', 'api', 'analytics', 'advanced', 'route.ts');
const src = fs.readFileSync(file, 'utf8');
const lines = src.split(/\r?\n/);

const BT = String.fromCharCode(96);
let i = 0;
let n = 0;
while (i < lines.length) {
  const idx = lines[i].indexOf('sql' + BT);
  if (idx === -1) {
    i++;
    continue;
  }
  // Collect from this line until the closing backtick on some later line.
  let body = lines[i].slice(idx + 4);
  let j = i;
  while (j < lines.length - 1 && body.indexOf(BT) === -1) {
    j++;
    body += '\n' + lines[j];
  }
  const end = body.indexOf(BT);
  const query = end === -1 ? body : body.slice(0, end);

  n++;
  const tables = [...query.matchAll(/(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)/gi)].map((m) => m[1]);
  const hasOrg = /organization_id\s*=/i.test(query) || /\$\{\s*orgId\s*\}/.test(query);
  const whereCount = (query.match(/\bWHERE\b/gi) || []).length;

  console.log(
    `#${String(n).padStart(2)} L${String(i + 1).padStart(4)}  org=${hasOrg ? 'Y' : 'N'}  where=${whereCount}  tables=[${[...new Set(tables)].join(', ')}]`
  );
  i = j + 1;
}
console.log(`\nTOTAL sql templates: ${n}`);
