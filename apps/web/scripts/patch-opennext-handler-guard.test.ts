/**
 * G2 HANDLER GUARD � regression test for patch-opennext-handler-guard.mjs
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `GET /` intermittently 500s in production with:
 *
 *     TypeError: components.ComponentMod.handler is not a function
 *
 * The call site lives in the OpenNext-GENERATED bundle
 * (`.open-next/server-functions/default/apps/web/handler.mjs`), not in
 * `src/`, so it cannot be fixed in application code. Root cause is still
 * UNCONFIRMED (matrix: chunk-loading hypothesis DISPROVEN; memory hypothesis
 * unmeasured) and it has NOT been reproduced under controlled load � 19/19
 * clean on `dealswift-loadtest` at Worker `e420f138`, 59/59 cumulative.
 *
 * UNIFIED-REQUIREMENTS-MATRIX.md step 1 for G2 is therefore explicitly:
 *
 *     "add a guarded call so a failed module load returns a diagnosable error
 *      instead of a TypeError"
 *
 * That is a diagnosability fix, NOT a root-cause fix, and it is deliberately
 * scoped that way. It converts an undiagnosable intermittent 500 into one that
 * logs a greppable marker plus the diagnostics needed to attribute it.
 *
 * This patch runs at BUILD TIME, following the precedent already established by
 * `patch-opennext-instrumentation.mjs`, which rewrites the inlined Turbopack
 * instrumentation stub inside the same handler.mjs (the adapter bundles the
 * on-disk file away, so patching the source alone has no effect).
 *
 * WHAT IS ASSERTED
 * 1. The REAL call-site text captured from a production handler.mjs is guarded.
 * 2. The unguarded call no longer exists after patching.
 * 3. The guard logs the `[g2-handler-guard]` marker and throws a named error.
 * 4. Patching is IDEMPOTENT (second run changes nothing).
 * 5. A handler without the call site is left untouched (no over-match).
 * 6. The script fail-safes when `.open-next` has not been built.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
  GUARD_MARKER,
  UNGUARDED_CALL,
  patchHandlerSource,
  buildGuardedSource,
} from './patch-opennext-handler-guard.mjs';

/**
 * Captured VERBATIM from
 * `.open-next/server-functions/default/apps/web/handler.mjs` at Worker
 * `e420f138` (2026-10-09). Keep this literal byte-accurate: if OpenNext changes
 * the shape, test 1 fails loudly instead of the guard silently not matching.
 */
const REAL_CALL_SITE =
  'opts.err&&(0,_requestmeta.addRequestMeta)(request,"invokeError",opts.err);let handlerReq=request,handlerRes=response;return await components.ComponentMod.handler(handlerReq,handlerRes,{waitUntil:this.getWaitUntil()}),null}stripNextDataPath(filePath,stripLocale=!0){';

describe('G2 handler guard', () => {
  it('guards the REAL call site captured from the shipped bundle', () => {
    const out = patchHandlerSource(REAL_CALL_SITE);
    expect(out.changed).toBe(true);
    expect(out.source).toContain(GUARD_MARKER);
    // the guarded call must still be present � we do not remove the happy path
    expect(out.source).toContain('components.ComponentMod.handler(handlerReq,handlerRes');
    // the UNGUARDED `return await ...` form must be gone
    expect(out.source).not.toMatch(
      /\bhandlerRes=response;return\s+await/i
    );

    // the type check must run BEFORE the call
    expect(out.source.indexOf('typeof components.ComponentMod.handler')).toBeLessThan(
      out.source.indexOf('components.ComponentMod.handler(handlerReq,handlerRes'),
    );
  });

  it('emits a greppable marker and a named error type', () => {
    const src = buildGuardedSource();
    expect(src).toContain('[g2-handler-guard]');
    expect(src).toContain('PageModuleLoadError');
    // diagnostics that let the failure be ATTRIBUTED, per matrix step 1
    expect(src).toContain('rssMB');
    expect(src).toContain('routeModule');
  });

  it('is idempotent � a second patch changes nothing', () => {
    const once = patchHandlerSource(REAL_CALL_SITE);
    const twice = patchHandlerSource(once.source);
    expect(twice.changed).toBe(false);
    expect(twice.source).toBe(once.source);
    // and it does not accumulate duplicate guards
    const count = once.source.split(GUARD_MARKER).length - 1;
    expect(count).toBe(1);
  });

  it('leaves a handler without the call site untouched', () => {
    const other = 'function foo(){return 1}var x=2;';
    const out = patchHandlerSource(other);
    expect(out.changed).toBe(false);
    expect(out.source).toBe(other);
  });

  it('fail-safes with exit 0 when .open-next has not been built', () => {
    // run from the repo root, where no .open-next exists
    const script = join(process.cwd(), 'scripts', 'patch-opennext-handler-guard.mjs');
    const out = execFileSync(process.execPath, [script], {
      cwd: process.cwd() + '/..',
      encoding: 'utf8',
    });
    expect(out).toContain('nothing to patch');
  });
});
