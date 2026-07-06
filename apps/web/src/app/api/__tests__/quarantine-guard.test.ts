/**
 * QUARANTINE GUARD — variant-allocator + resurrection-engine are DEAD CODE.
 *
 * Verification sprint (2026-07): both engines query tables
 * (message_performance_ledger, resurrection_campaign_config,
 * resurrection_sent_log) that exist in NO schema file, NO migration, and NOT in
 * the live DB; their ensure*Schema() DDL is never called; ResurrectionEngine
 * .getConfig() reads a `.rows` field the sql client never returns (so it always
 * returns defaults). They are wired into no runtime path. See FINAL_STATE.md
 * ("NOT DEPLOYABLE / DEAD CODE").
 *
 * This test fails if ANY runtime file (routes / cron / jobs / gateway /
 * services / pages / lib) imports either engine — so nobody can silently wire
 * dead code back in without first going through a real build session that adds
 * migration 004, fixes getConfig(), and gives these features behavioral tests.
 * When the engines are made real, delete this guard in the same PR.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';

const SRC = resolve(process.cwd(), 'src');

// Module specifiers that must never be imported by shipped/runtime code.
const QUARANTINED = ['variant-allocator', 'resurrection-engine'];

// Files allowed to reference them: the engines themselves, their own tests,
// and this guard.
function isExempt(file: string): boolean {
  const f = file.replace(/\\/g, '/');
  return (
    f.includes('/outreach/variant-allocator') ||
    f.includes('/outreach/resurrection-engine') ||
    f.endsWith('.test.ts') ||
    f.endsWith('.test.tsx') ||
    f.includes('/__tests__/')
  );
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

// Matches a quoted module specifier ending in the engine name — i.e. an actual
// import/require path, not an underscore-style string literal like
// 'resurrection_sent'. Engine names use hyphens; those only appear in paths.
const specifier = new RegExp(`['"][^'"]*(?:${QUARANTINED.join('|')})['"]`);

describe('Quarantine guard: dead engines must not be wired into runtime code', () => {
  it('no runtime file imports variant-allocator or resurrection-engine', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      if (isExempt(file)) continue;
      const content = readFileSync(file, 'utf8');
      if (specifier.test(content)) {
        offenders.push(file.replace(/\\/g, '/').replace(/.*\/src\//, 'src/'));
      }
    }
    expect(offenders, `Dead engines wired into runtime code: ${offenders.join(', ')}`).toEqual([]);
  });
});
