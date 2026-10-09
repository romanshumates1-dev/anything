// One-off: extract meta/title/og tags from local HTML files.
import { readFileSync } from 'node:fs';
const h = readFileSync(process.argv[2], 'utf8');
for (const pat of [
  /<title[^>]*>([^<]*)<\/title>/,
  /<meta name="description" content="([^"]*)"/,
  /<meta property="og:title" content="([^"]*)"/,
  /<meta property="og:image" content="([^"]*)"/,
  /<meta name="twitter:image" content="([^"]*)"/,
  /<link rel="canonical" href="([^"]*)"/,
]) {
  const m = h.match(pat);
  console.log(pat.source.slice(0, 40), '->', m ? m[1] : 'NOT FOUND');
}