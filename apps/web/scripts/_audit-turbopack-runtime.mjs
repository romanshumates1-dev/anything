// Audit the generated Turbopack runtime for chunk-loading defects behind
// "TypeError: components.ComponentMod.handler is not a function".
//
// BACKGROUND (upstream, so this is a hypothesis to test, not a conclusion)
// ------------------------------------------------------------------------
// opennextjs/opennextjs-cloudflare#1305: on Windows the Turbopack patch filters
// traced paths against forward-slash literals, so `requireChunk()` is emitted
// with an EMPTY switch; loading any page chunk then throws ChunkLoadError,
// which surfaces at request time as exactly this TypeError. #1258 is a related
// Next 16 variant. Both reported against 1.19.x / 1.20.1.
//
// This tests two distinct failure modes:
//   A. the empty switch (#1305), and
//   B. require() targets left as ABSOLUTE build-machine paths.
//
// It reports INTERMEDIATE and DEPLOYED artefacts separately, because they
// legitimately differ: the bundler rewrites `require("D:/...")` into an inlined
// function per chunk, so absolute paths in the intermediate file are expected
// and are NOT a deploy bug. Judging only one of the two is how a false verdict
// gets written — an earlier version of this script did exactly that.
//
// Read-only: never executes the bundle, never deploys.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SERVER = join(process.cwd(), '.open-next', 'server-functions', 'default', 'apps', 'web');
const ARTEFACTS = [
  ['INTERMEDIATE chunk file', join(SERVER, '.next', 'server', 'chunks', '[turbopack]_runtime.js')],
  ['DEPLOYED handler bundle', join(SERVER, 'handler.mjs')],
];

/**
 * Extract a function body by brace counting.
 *
 * A first attempt used `indexOf('\n}', ...)`, which never matches because the
 * generated body is indented. That returned an empty slice and the audit then
 * reported "0 cases -> BUG CONFIRMED" for a build that has 2038. A parser that
 * silently yields nothing must never be trusted to confirm a bug.
 */
function extractFunction(src, name) {
  const at = src.indexOf(`function ${name}`);
  if (at < 0) throw new Error(`${name}() not found - build shape changed, re-investigate`);
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(at, i + 1);
    }
  }
  throw new Error(`could not find the end of ${name}()`);
}

function analyse(label, file) {
  console.log(`\n=== ${label} ===`);
  let src;
  try {
    src = readFileSync(file, 'utf8');
  } catch {
    console.log('  (absent - run the production build first)');
    return null;
  }

  const body = extractFunction(src, 'requireChunk');
  const caseTokens = (body.match(/\bcase\b/g) || []).length;
  const requires = [...body.matchAll(/case\s+"([^"]+)"\s*:\s*return\s+require\(\s*"([^"]+)"\s*\)/g)];
  const inlined = [...body.matchAll(/case\s+"([^"]+)"\s*:\s*return\s+([A-Za-z_$][\w$]*)\(\s*\)/g)];
  const hasDefaultThrow = /default\s*:\s*throw/.test(body);
  const absolute = requires.filter(([, , t]) => /^[A-Za-z]:[\\/]/.test(t) || t.startsWith('/'));

  console.log(`  switch cases            : ${caseTokens}`);
  console.log(`  require("<path>") form  : ${requires.length}`);
  console.log(`  inlined fn() form       : ${inlined.length}`);
  console.log(`  default: throw fallback : ${hasDefaultThrow ? 'yes' : 'NO'}`);
  if (requires.length) console.log(`  absolute require targets : ${absolute.length} / ${requires.length}`);

  let verdict;
  if (caseTokens === 0) verdict = 'EMPTY SWITCH -> opennextjs#1305 confirmed for this artefact';
  else if (absolute.length > 0 && absolute.length === requires.length)
    verdict = 'every require() target is an absolute build-machine path';
  else if (inlined.length > 0 && absolute.length === 0)
    verdict = 'chunks inlined as functions, no filesystem paths remain. SOUND.';
  else verdict = 'mixed form - inspect manually';

  console.log(`  VERDICT: ${verdict}`);
  return { caseTokens, absolute: absolute.length, inlined: inlined.length, hasDefaultThrow, verdict };
}

const results = ARTEFACTS.map(([label, file]) => analyse(label, file));
const deployed = results[results.length - 1];

console.log('\n=== SUMMARY ===');
if (!deployed) console.log('No deployed bundle to judge. Build first.');
else if (deployed.caseTokens === 0) console.log('DEPLOYED ARTEFACT BROKEN: empty requireChunk switch.');
else if (deployed.absolute > 0)
  console.log(`DEPLOYED ARTEFACT BROKEN: ${deployed.absolute} absolute require() paths cannot resolve at runtime.`);
else if (deployed.caseTokens > 0 && deployed.hasDefaultThrow) {
  console.log(`DEPLOYED ARTEFACT SOUND: ${deployed.caseTokens} cases, chunks inlined, fallback present.`);
  console.log('If this TypeError is still seen in production, the cause is NOT chunk loading.');
}
console.log('Note: absolute paths in the INTERMEDIATE file are expected; the bundler rewrites them.');
