/**
 * Shared source-tree scanner for the static "ratchet" guard tests.
 *
 * WHY THIS EXISTS
 * ---------------
 * Six guard tests (error-hardening, aggregate-oracle, lead-insert-org,
 * regression-guards, secret-compare, synthetic-lead-gate) each shipped their own
 * near-identical `walk()` that traversed the whole `src` tree with
 * `readdirSync()` + `statSync()`. Three of them called it at MODULE LOAD, so the
 * cost was paid during *collection*, not during the test bodies - which is why a
 * full suite showed `collect 106.62s` against `tests 76.53s`.
 *
 * Measured on this machine (755 files / 5.86 MB under src/):
 *
 *   statSync traversal ..... 432-638 ms per walk
 *   withFileTypes traversal  113-132 ms per walk      (~4x faster)
 *
 * `withFileTypes` returns the entry type from the SAME syscall that already
 * listed the directory, so the per-entry `statSync` round-trip is eliminated
 * entirely. On Windows that round-trip is the dominant cost.
 *
 * Six independent copies also meant the same 5.86 MB was walked and re-read six
 * times per suite run. Consolidating to one memoized helper removes that
 * duplication (DRY) *and* the I/O storm that made the guards time out at 5s when
 * `tsc` was running concurrently - the flake recorded in
 * MASTER-REQUIREMENTS-MATRIX.md section 19.
 *
 * SELECTION SEMANTICS ARE PRESERVED EXACTLY
 * ----------------------------------------
 * The six guards intentionally scan different roots, extensions and exclusions
 * (e.g. aggregate-oracle deliberately INCLUDES test files; regression-guards
 * only wants `route.ts`). Those differences are expressed as options below so no
 * guard silently loses coverage.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ScanOptions {
  /** Extensions to include, without the leading dot. Default: ts, tsx. */
  extensions?: readonly string[];
  /** Directory names to never descend into. */
  skipDirs?: readonly string[];
  /**
   * When true (default) test files are EXCLUDED. aggregate-oracle intentionally
   * passes `false` because it also wants to police fixtures.
   */
  excludeTests?: boolean;
  /** Match only this exact filename (e.g. 'route.ts'). */
  onlyFile?: string;
}

const DEFAULT_EXT = ['ts', 'tsx'] as const;
const DEFAULT_SKIP = ['node_modules', '__tests__', '.next'] as const;

const TEST_FILE_RE = /\.(test|spec)\./;

const listCache = new Map<string, readonly string[]>();
const textCache = new Map<string, string>();

/** Cache key must encode every option that changes the resulting file set. */
function cacheKey(root: string, o: Required<ScanOptions>): string {
  return [
    root,
    o.extensions.join(','),
    o.skipDirs.join(','),
    o.excludeTests,
    o.onlyFile ?? '',
  ].join('|');
}

/**
 * List candidate source files under `root`.
 *
 * Memoized per (root, options). Returns a frozen array so a caller cannot mutate
 * the cache - a mutated cache would make one guard's filtering leak into
 * another's results, which is exactly the kind of cross-test coupling these
 * guards must not have.
 */
export function scanSource(root: string, options: ScanOptions = {}): readonly string[] {
  const opts: Required<ScanOptions> = {
    extensions: options.extensions ?? DEFAULT_EXT,
    skipDirs: options.skipDirs ?? DEFAULT_SKIP,
    excludeTests: options.excludeTests ?? true,
    onlyFile: options.onlyFile ?? '',
  };
  const key = cacheKey(root, opts);
  const hit = listCache.get(key);
  if (hit) return hit;

  const out: string[] = [];
  const extSet = new Set(opts.extensions.map((e) => `.${e}`));

  // Iterative to avoid deep recursion; the entry type comes free with the
  // readdirSync call, so there is no statSync per file.
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      // A directory can vanish mid-walk (or be unreadable under permissions);
      // skipping it matches the previous existsSync-guard behaviour.
      continue;
    }
    for (const ent of entries) {
      const name = ent.name;
      if (ent.isDirectory()) {
        if (!opts.skipDirs.includes(name)) stack.push(join(dir, name));
        continue;
      }
      if (!ent.isFile()) continue;
      if (opts.onlyFile) {
        if (name === opts.onlyFile) out.push(join(dir, name));
        continue;
      }
      if (!extSet.has(name.slice(name.lastIndexOf('.')))) continue;
      if (opts.excludeTests && TEST_FILE_RE.test(name)) continue;
      out.push(join(dir, name));
    }
  }

  // Deterministic order: guards report offenders in this order, and a stable
  // order keeps failure output reproducible across runs and platforms.
  out.sort();
  const frozen = Object.freeze(out);
  listCache.set(key, frozen);
  return frozen;
}

/**
 * Read a source file as UTF-8, memoized.
 *
 * Several guards re-read the same file (e.g. secret-compare scans every file and
 * then re-reads twelve specific ones). Memoizing turns those repeat reads into
 * map lookups.
 */
export function readSource(file: string): string {
  const hit = textCache.get(file);
  if (hit !== undefined) return hit;
  const text = readFileSync(file, 'utf8');
  textCache.set(file, text);
  return text;
}

/** `src/app/api` - the API surface most guards police. */
export const API_ROOT = join(process.cwd(), 'src', 'app', 'api');
/** All of `src` - used by guards that police shared libs too. */
export const SRC_ROOT = join(process.cwd(), 'src');
