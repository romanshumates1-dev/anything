/**
 * Keeps `src/instrumentation.ts` and the inlined `register()` in
 * `scripts/patch-opennext-instrumentation.mjs` from drifting apart.
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * The patch script carried this warning for several sessions:
 *
 *   ⚠ KEEP-IN-SYNC: the register() below mirrors `src/instrumentation.ts`
 *
 * ...while `src/instrumentation.ts` did not exist on this branch at all. It had
 * been added in `25da172`, which lives only on `claude/superpowers-saas-tiers-*`
 * and is not an ancestor of HEAD. So the instruction was impossible to obey, and
 * nothing detected that. The file was restored on 2026-10-04; this test makes the
 * relationship enforceable rather than aspirational.
 *
 * Two copies of the same boot logic WILL drift. This is not a hypothetical: the
 * two versions that existed already disagreed — the orphaned branch file used
 * `assertEnv`/`validateEnv` (a module that does not exist here) while the patch
 * script inlined `HARD_REQUIRED`/`SOFT_RECOMMENDED`.
 *
 * WHAT IS ASSERTED
 * ----------------
 * The two required-var lists and the recommended-var list must match exactly.
 * They are deliberately compared as CONTENT, not by regexing the whole file:
 * a genuine refactor should be allowed as long as the actual boot contract — the
 * set of fatal vars and the set of degraded-only vars — is identical.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src', 'instrumentation.ts');
const PATCH = join(process.cwd(), 'scripts', 'patch-opennext-instrumentation.mjs');

/** Read a JS array literal of quoted strings and return its members. */
function readArray(file: string, name: string): string[] {
  const text = readFileSync(file, 'utf8');
  const match = text.match(new RegExp(`${name}\\s*=\\s*\\[([^\\]]*)\\]`));
  if (!match) throw new Error(`Could not find ${name} in ${file}`);
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

describe('instrumentation boot contract', () => {
  it('src/instrumentation.ts exists — the patch script claims to mirror it', () => {
    expect(readFileSync(SRC, 'utf8')).toContain('export function register');
  });

  it('the fatal env list matches the patch script exactly', () => {
    const fromSrc = [...readArray(SRC, 'HARD_REQUIRED')].sort();
    const fromPatch = [...readArray(PATCH, 'HARD_REQUIRED')].sort();
    expect(fromSrc).toEqual(fromPatch);
  });

  it('the degraded-only env list matches the patch script exactly', () => {
    const fromSrc = [...readArray(SRC, 'SOFT_RECOMMENDED')].sort();
    const fromPatch = [...readArray(PATCH, 'SOFT_RECOMMENDED')].sort();
    expect(fromSrc).toEqual(fromPatch);
  });

  it('DATABASE_URL and BETTER_AUTH_SECRET stay fatal — losing either would boot a broken app', () => {
    const fatal = readArray(SRC, 'HARD_REQUIRED');
    expect(fatal).toContain('DATABASE_URL');
    expect(fatal).toContain('BETTER_AUTH_SECRET');
  });

  it('Workers does NOT throw on missing required vars, so /api/system/health stays reachable', () => {
    // A throw here would turn a config mistake into a total outage: the Worker
    // would fail to boot and every route, including the health probe that would
    // have explained the problem, would return 5xx.
    expect(readFileSync(SRC, 'utf8')).toMatch(/isCloudflareWorkers[\s\S]*return;/);
  });

  it('never imports the boot-validation helper from the orphaned branch', () => {
    // The version on the orphaned branch imported assertEnv/validateEnv from a
    // module that does not exist on this branch. Guard against it being pasted
    // back. The match is built at runtime so this test's own source does not
    // contain the forbidden string.
    const forbidden = ['env' + '-validation'].join('');
    expect(readFileSync(SRC, 'utf8')).not.toContain(forbidden);
  });
});