// One-off audit: find mojibake + placeholder text in marketing metadata.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const files = execSync('git ls-files "src/app/(marketing)"', { encoding: 'utf8' }).trim().split('\n');
const MOJIBAKE = /[\u00c3\u00e2\u0080\u0089\u00c2]/;
let mojibake = 0;
for (const f of files) {
  const t = readFileSync(f, 'utf8');
  // Real mojibake markers: â€”, Ã, â„¢ etc. (UTF-8 read as cp1252)
  if (/â€|Ã|â„¢|Â/.test(t)) {
    mojibake++;
    console.log('MOJIBAKE:', f);
    for (const line of t.split('\n')) {
      if (/â€|Ã|â„¢|Â/.test(line)) console.log('   ', line.trim().slice(0, 160));
    }
  }
}
console.log('mojibake files:', mojibake);

// Placeholder strings leaking into shipped metadata
for (const f of files) {
  const t = readFileSync(f, 'utf8');
  if (/requires attorney review|TBD|FIXME|lorem ipsum/i.test(t)) {
    console.log('PLACEHOLDER:', f);
    for (const line of t.split('\n')) {
      if (/requires attorney review|TBD|FIXME|lorem ipsum/i.test(line)) console.log('   ', line.trim().slice(0, 160));
    }
  }
}