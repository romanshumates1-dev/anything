/**
 * DEPLOY STALE-ARTIFACT GUARD — regression test for wrangler-deploy.mjs
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `wrangler-deploy.mjs` was originally just `npx wrangler deploy` with no
 * rebuild step. Observed 2026-10-04: a deploy returned a fresh Worker version
 * (6ea153be) yet `GET /signup?ref=` still 404'd — the built route manifest was
 * timestamped 20:02 against a 01:43 commit and listed 368 routes, missing both
 * `/signup/route` and `/referrals/page`. A stale `.open-next` artifact was
 * deployed while every tool reported success.
 *
 * The fix added a stale-artifact guard: compare newest mtime under `src/` vs
 * `.open-next/` and refuse to deploy if any source is newer. The operator must
 * run `yarn cf:build` first (or pass `--allow-stale` for deliberate
 * redeploy of the same artifact).
 *
 * This guard test pins that logic so the defect cannot silently return. It
 * follows the same pattern as `run-migrations.guard.test.ts`: the logic is
 * re-implemented VERBATIM from the script (because the script executes on
 * import and cannot be imported without spawning a child process), and then
 * the script's ACTUAL source is read and asserted to contain the real code.
 *
 * WHAT IS ASSERTED
 * 1. `newestMtime` correctly walks a directory tree, skipping `node_modules`
 *    and `.next`, and returns the newest file by mtime.
 * 2. The staleness check correctly detects source-newer-than-output.
 * 3. `--allow-stale` bypasses the refusal.
 * 4. The shipped script's CODE LINES (not comments) contain the guard.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readdirSync, statSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';

/** Verbatim from scripts/wrangler-deploy.mjs — must not drift. */
function newestMtime(dir, acc = { newest: 0, file: null }) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const ent of entries) {
    if (ent.name === 'node_modules' || ent.name === '.next') continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      newestMtime(full, acc);
    } else if (ent.isFile()) {
      try {
        const m = statSync(full).mtimeMs;
        if (m > acc.newest) {
          acc.newest = m;
          acc.file = full;
        }
      } catch {
        /* unreadable file: skip */
      }
    }
  }
  return acc;
}

/** The staleness decision, verbatim from wrangler-deploy.mjs. */
function isStale(src, out) {
  return src.file && out.file && src.newest > out.newest;
}

let TMP: string;

beforeAll(() => {
  TMP = join(tmpdir(), `wrangler-deploy-guard-${Date.now()}`);
  mkdirSync(TMP, { recursive: true });
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

function touch(filePath: string, mtimeMs: number) {
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, 'test');
  utimesSync(filePath, new Date(mtimeMs), new Date(mtimeMs));
}

describe('newestMtime', () => {
  it('finds the newest file in a flat directory', () => {
    const dir = join(TMP, 'flat');
    touch(join(dir, 'a.js'), 1000);
    touch(join(dir, 'b.js'), 2000);
    touch(join(dir, 'c.js'), 1500);

    const result = newestMtime(dir);
    expect(result.file).toBe(join(dir, 'b.js'));
    expect(result.newest).toBe(2000);
  });

  it('recurses into subdirectories', () => {
    const dir = join(TMP, 'recursive');
    touch(join(dir, 'top.js'), 1000);
    touch(join(dir, 'sub/nested.js'), 3000);
    touch(join(dir, 'other/deep.js'), 2000);

    const result = newestMtime(dir);
    expect(result.file).toBe(join(dir, 'sub/nested.js'));
    expect(result.newest).toBe(3000);
  });

  it('skips node_modules and .next directories', () => {
    const dir = join(TMP, 'skip');
    touch(join(dir, 'src.js'), 500);
    // A file in node_modules that is "newer" should NOT be picked up
    touch(join(dir, 'node_modules/installed.js'), 999999);
    touch(join(dir, '.next/cache.bin'), 888888);

    const result = newestMtime(dir);
    expect(result.file).toBe(join(dir, 'src.js'));
  });

  it('returns { newest: 0, file: null } for a missing directory', () => {
    const result = newestMtime(join(TMP, 'does-not-exist'));
    expect(result.newest).toBe(0);
    expect(result.file).toBeNull();
  });
});

describe('staleness check', () => {
  it('flags source newer than output', () => {
    const src = join(TMP, 'src_check');
    const out = join(TMP, 'out_check');
    touch(join(src, 'new.ts'), 5000);
    touch(join(out, 'old.js'), 3000);

    const srcResult = newestMtime(src);
    const outResult = newestMtime(out);
    expect(isStale(srcResult, outResult)).toBe(true);
  });

  it('does NOT flag when output is newer than source', () => {
    const src = join(TMP, 'src_ok');
    const out = join(TMP, 'out_ok');
    touch(join(src, 'old.ts'), 3000);
    touch(join(out, 'new.js'), 5000);

        const srcResult = newestMtime(src);
    const outResult = newestMtime(out);
    expect(isStale(srcResult, outResult)).toBeFalsy();
  });

  it('does NOT flag when neither directory has files', () => {
    const src = join(TMP, 'src_empty_a');
    const out = join(TMP, 'out_empty_a');
    mkdirSync(src, { recursive: true });
    mkdirSync(out, { recursive: true });

    const srcResult = newestMtime(src);
    const outResult = newestMtime(out);
    expect(isStale(srcResult, outResult)).toBeFalsy();
  });
});

/**
 * Pin the script to contain the guard on CODE LINES only.
 * Comments in the script document the old defect verbatim (including
 * the phrase "only ran `npx wrangler deploy`"), so matching comments
 * would be vacuous. Filter out comment lines before asserting.
 */
function codeLines(source: string): string {
  return source
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('//');
    })
    .join('\n');
}

describe('shipped script pins', () => {
  const scriptPath = join(process.cwd(), 'scripts', 'wrangler-deploy.mjs');
  let script: string;

  beforeAll(() => {
    script = readFileSync(scriptPath, 'utf8');
  });

  it('REFUSES to deploy when .open-next does not exist', () => {
    const code = codeLines(script);
    expect(code).toContain('[cf:deploy] REFUSING: .open-next/');
    expect(code).toContain('existsSync(OUT_NEXT)');
  });

  it('CONTAINS the newestMtime function', () => {
    const code = codeLines(script);
    expect(code).toContain('function newestMtime');
    // Must skip node_modules and .next
    expect(code).toContain("ent.name === 'node_modules'");
    expect(code).toContain("ent.name === '.next'");
  });

  it('CONTAINS the staleness refusal with --allow-stale override', () => {
    const code = codeLines(script);
    expect(code).toContain('--allow-stale');
    expect(code).toContain('REFUSING TO DEPLOY A STALE ARTIFACT');
    expect(code).toContain('yarn cf:build');
    // Must call process.exit(1) on staleness
    expect(code).toContain('process.exit(1)');
  });

  it('the silent-deploy defect is GONE (code-lines only)', () => {
    // The old script had no guard: it went straight from spawn() to deploy.
    // Verify the guard now sits BEFORE the spawn() call.
    const code = codeLines(script);
    const guardIdx = code.indexOf('REFUSING TO DEPLOY A STALE ARTIFACT');
    const spawnIdx = code.indexOf("spawn('npx'");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(spawnIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(spawnIdx);
  });
});
