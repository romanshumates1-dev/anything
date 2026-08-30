#!/usr/bin/env node
/**
 * Phase 1 link checker — crawls every internal href reachable from the
 * marketing surface (not a hand-maintained list) and asserts 200 on all of
 * them. Run against a live dev server:
 *   node scripts/link-check.mjs
 *
 * Rewritten from a prior version that was TypeScript saved as .mjs (syntax
 * error on plain `node`, never actually ran) and only ever checked a
 * hardcoded array rather than real page hrefs — see BREAKAGE_TABLE.md
 * "Phase 1 environment/tooling" entry.
 */
const BASE_URL = process.env.BASE_URL || 'http://localhost:4000';

const SEEDS = [
  '/', '/how-it-works', '/features', '/pricing', '/faq', '/about', '/contact',
  '/trust', '/reviews', '/compliance',
  '/legal/terms', '/legal/privacy', '/legal/acceptable-use', '/legal/sms-terms',
  '/legal/refunds', '/legal/cookies', '/legal/disclaimers', '/legal/esign', '/legal/dmca',
];

const HREF_RE = /href="([^"#?]+)/g;

async function fetchStatus(path) {
  try {
    // Follow redirects manually so a 308 (e.g. /compliance -> /trust) counts
    // as a pass, but we still learn the target for crawling.
    const res = await fetch(BASE_URL + path, { redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      return { status: res.status, redirectTo: loc, body: '' };
    }
    const body = res.status === 200 ? await res.text() : '';
    return { status: res.status, body };
  } catch (e) {
    return { status: null, error: e.message, body: '' };
  }
}

async function main() {
  const visited = new Map(); // path -> status
  const queue = [...SEEDS];
  const isInternal = (href) =>
    href.startsWith('/') && !href.startsWith('//') && !href.startsWith('/api/');

  while (queue.length) {
    const path = queue.shift();
    if (visited.has(path)) continue;

    const { status, redirectTo, body, error } = await fetchStatus(path);
    visited.set(path, status ?? `ERROR:${error}`);

    if (status && status >= 300 && status < 400 && redirectTo) {
      const target = redirectTo.startsWith('http') ? new URL(redirectTo).pathname : redirectTo;
      if (isInternal(target) && !visited.has(target)) queue.push(target);
      continue;
    }
    if (status !== 200) continue;

    for (const m of body.matchAll(HREF_RE)) {
      const href = m[1];
      if (isInternal(href) && !visited.has(href) && !queue.includes(href)) {
        queue.push(href);
      }
    }
  }

  const rows = [...visited.entries()].sort(([a], [b]) => a.localeCompare(b));
  let failed = 0;
  for (const [path, status] of rows) {
    const ok = status === 200 || (typeof status === 'number' && status >= 300 && status < 400);
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} ${String(status).padEnd(10)} ${path}`);
  }

  console.log(`\nLink check: ${rows.length} internal hrefs crawled, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main();
