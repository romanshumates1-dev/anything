// Adversarial scan #2: find every place a security decision depends on an env var
// that DEFAULTS to a mock/dev value. These are the "silent insecure default" sites.
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SKIP = new Set(['node_modules', '.next', '.open-next', '.wrangler', 'dist', '.git', '.legacy-quarantine', 'coverage']);

// Patterns where a missing env var falls back to something permissive.
const RISKY = [
  { re: /process\.env\.[A-Z0-9_]+\s*\|\|\s*['"](mock|dev|development|test|none|true)['"]/g, why: 'env default is a permissive/mock value' },
  { re: /process\.env\.[A-Z0-9_]+\s*\?\?\s*['"](mock|dev|development|test|none|true)['"]/g, why: 'env default is a permissive/mock value' },
];

const findings = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (/\.(ts|tsx|js|cjs|mjs)$/.test(entry.name)) {
      let src;
      try { src = fs.readFileSync(p, 'utf8'); } catch { return; }
      const lines = src.split(/\r?\n/);
      lines.forEach((line, i) => {
        for (const { re, why } of RISKY) {
          re.lastIndex = 0;
          if (re.test(line)) {
            findings.push({
              file: path.relative(ROOT, p).replace(/\\/g, '/'),
              line: i + 1,
              text: line.trim().slice(0, 130),
              why,
            });
          }
        }
      });
    }
  }
}

walk(path.join(ROOT, 'src'));

console.log(`SITES WHERE A MISSING ENV VAR DEFAULTS TO A MOCK/DEV VALUE: ${findings.length}\n`);
const byFile = new Map();
for (const f of findings) {
  if (!byFile.has(f.file)) byFile.set(f.file, []);
  byFile.get(f.file).push(f);
}
for (const [file, items] of [...byFile.entries()].sort()) {
  console.log(file);
  for (const it of items) console.log(`   L${it.line}: ${it.text}`);
  console.log('');
}
