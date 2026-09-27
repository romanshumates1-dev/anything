/**
 * Counts nested-`sql` sites per file (defect #32, second wave).
 *
 * A migration tracker: each entry is a route/util that still builds dynamic
 * SQL by interpolating a `sql` fragment, which this driver turns into a
 * positional parameter (500, or silently wrong results). Run it to see what is
 * left; the guard test pins the counts so they cannot grow.
 *
 *   node scripts/scan-fragments.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');
const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.next') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.(test|spec)\.ts$/.test(e.name)) {
      files.push(p);
    }
  }
})(SRC);

const INLINE = /\$\{[^}]*\bsql`/;
const codeLines = (t) =>
  t.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));

const counts = new Map();
let total = 0;
for (const file of files) {
  const hits = codeLines(readFileSync(file, 'utf8')).filter((l) => INLINE.test(l));
  if (hits.length) {
    const rel = file.replace(join(process.cwd(), 'src', 'app', 'api') + '\\', 'api/').replace(/\\/g, '/');
    counts.set(rel, hits.length);
    total += hits.length;
  }
}

for (const [file, n] of [...counts.entries()].sort()) {
  console.log(`  '${file}': ${n},`);
}
console.log(`TOTAL nested-fragment sites: ${total} across ${counts.size} files`);
process.exit(0);
