/**
 * DEPLOY INTEGRITY RATCHET (2026-10-04).
 *
 * A deploy that silently ships yesterday's bundle is worse than a deploy that
 * fails, because it converts "my fix is live" into a belief that is false.
 *
 * THE INCIDENT THIS PREVENTS
 * --------------------------
 * `scripts/wrangler-deploy.mjs` originally spawned only `npx wrangler deploy`.
 * It never rebuilt, so deploying after a code change published the PREVIOUS
 * `.open-next` and reported success. Measured on 2026-10-04: a deploy returned a
 * fresh Worker version (`6ea153be`) while `GET /signup?ref=` still 404'd on both
 * the apex and workers.dev. The built route manifest was timestamped 20:02
 * against a 01:43 commit and listed 368 routes, with neither `/signup/route` nor
 * `/referrals/page` present even though both source files existed and were
 * committed. Rebuilding took it to 370 routes and the fix deployed immediately.
 *
 * These assertions pin the guard that now prevents a recurrence. They are static
 * checks on the script's source: cheap, deterministic, and impossible to satisfy
 * by accident.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { readSource, SRC_ROOT } from './_sourceScan';

const DEPLOY_SCRIPT = join(SRC_ROOT, '..', 'scripts', 'wrangler-deploy.mjs');

describe('deploy integrity ratchet', () => {
  const src = readSource(DEPLOY_SCRIPT);

  it('refuses to deploy when the build output is older than src/', () => {
    // The staleness comparison is the whole point of the guard.
    expect(src).toContain('REFUSING TO DEPLOY A STALE ARTIFACT');
    expect(src).toMatch(/newest\s*>\s*out\.newest/);
  });

  it('exits non-zero when it refuses, so CI cannot treat it as success', () => {
    // The message alone is not enough: without a non-zero exit a wrapper script
    // or CI step would still record the deploy as successful.
    expect(src).toMatch(/REFUSING TO DEPLOY A STALE ARTIFACT[\s\S]*?process\.exit\(1\)/);
  });

  it('tells the operator how to fix it and how to override deliberately', () => {
    expect(src).toContain('yarn cf:build');
    expect(src).toContain('--allow-stale');
  });

  it('refuses outright when there is no build at all', () => {
    expect(src).toMatch(/does not exist[\s\S]*?process\.exit\(1\)/);
  });

  it('reports the registered route count, so a stale bundle is visible', () => {
    // 368 vs 370 routes is exactly what identified the stale deploy.
    expect(src).toContain('app-path-routes-manifest.json');
    expect(src).toMatch(/registered routes/);
  });

  it('still forwards --allow-stale to wrangler without passing it through', () => {
    // The flag is consumed locally; leaking it to wrangler would be a CLI error.
    expect(src).toContain("extraArgs.includes('--allow-stale')");
    expect(src).toContain("extraArgs.splice(");
  });

  it('declares extraArgs before it is read (no temporal dead zone)', () => {
    // Regression from the first implementation of this guard: `extraArgs` was
    // referenced above its `const`, which threw ReferenceError at load time and
    // made every deploy attempt fail with an empty error message.
    const decl = src.indexOf('const extraArgs');
    const use = src.indexOf('extraArgs.includes');
    expect(decl).toBeGreaterThanOrEqual(0);
    expect(use).toBeGreaterThanOrEqual(0);
    expect(decl).toBeLessThan(use);
  });

  it('spawns wrangler exactly once', () => {
    // Also a regression from the first implementation, which left two identical
    // spawn calls and would have attempted two concurrent deploys.
    const spawns = src.match(/spawn\('npx',\s*\['wrangler',\s*'deploy'/g) ?? [];
    expect(spawns.length).toBe(1);
  });
});